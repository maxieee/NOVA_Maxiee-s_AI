import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";

/**
 * Integration coverage for V5 Payment Intelligence: proves a payment
 * reminder goes through the EXACT SAME dueScan/decideFollowUp/provider
 * pipeline as any other reminder (no payment-specific escalation logic),
 * and that the cron-facing generation functions are idempotent across
 * repeated runs and multiple accounts.
 */
describe("Payment Intelligence — reuses the existing engine, idempotently", () => {
  const dbPaths: string[] = [];

  beforeEach(() => {
    vi.resetModules();
    // Use the OS temp dir (not process.cwd()) — the repo root can be inside a
    // cloud-synced folder (e.g. OneDrive on Windows), where real-time sync/AV
    // scanning of newly created SQLite (+ WAL/SHM) files can slow file I/O
    // enough to blow past the test timeout. os.tmpdir() is never synced.
    const dbPath = path.join(os.tmpdir(), `nova-payment-integration-test-${Date.now()}-${Math.random()}.sqlite`);
    dbPaths.push(dbPath);
    process.env.NOVA_SQLITE_PATH = dbPath;
    process.env.NOVA_DATA_SOURCE = "local";
    delete process.env.TWILIO_ACCOUNT_SID;
    delete process.env.TWILIO_AUTH_TOKEN;
    delete process.env.TWILIO_PHONE_NUMBER;
    delete process.env.VAPID_PUBLIC_KEY;
    delete process.env.VAPID_PRIVATE_KEY;
  });

  afterAll(() => {
    for (const p of dbPaths) {
      try {
        fs.unlinkSync(p);
      } catch {
        /* ignore */
      }
    }
  });

  it("a payment reminder with no configured channels honestly reports not_configured (never fakes success)", async () => {
    const { db } = await import("../lib/db");
    const { ensureUpcomingCycle } = await import("../lib/scheduling/paymentCycles");
    const { generateReminderForCycle } = await import("../lib/scheduling/paymentReminders");
    const { scanAndProcessDueReminders } = await import("../lib/scheduling/dueScan");

    const userId = db.getCurrentUserId();
    const account = db.createPaymentAccount(userId, {
      name: "Test Card",
      payment_type: "CREDIT_CARD",
      issuer: null,
      masked_identifier: "Card •••• 9999",
      active: true,
      statement_date_rule: 1,
      due_date_rule: "fixed_day",
      fixed_due_day: 20,
      due_days_after_statement: null,
      default_amount: 500,
      minimum_amount: null,
      autopay_enabled: false,
      reminder_enabled: true,
      escalation_enabled: true,
    });
    const cycle = ensureUpcomingCycle(account);
    const reminder = generateReminderForCycle(cycle, account, userId, ["push"], "normal")!;

    // Backdate the reminder's occurrence to "now" so dueScan picks it up.
    const occ = db.listOccurrences(reminder.id)[0];
    const Database = (await import("better-sqlite3")).default;
    const sqlite = new Database(process.env.NOVA_SQLITE_PATH!);
    sqlite
      .prepare(`update reminder_occurrences set scheduled_for = ? where id = ?`)
      .run(new Date(Date.now() - 60_000).toISOString(), occ.id);
    sqlite.close();

    const results = await scanAndProcessDueReminders();
    // The reminder has multiple lead-time occurrences (7/3/1 days + due
    // date) — only the backdated one is actually due this run. With no
    // channel configured at all, the EXISTING escalation engine honestly
    // stops (never fakes a "sent") rather than dispatching to a provider.
    const mine = results.find((r) => r.occurrenceId === db.listOccurrences(reminder.id)[0].id);
    expect(mine?.action).toBe("stopped");
    expect(mine?.reason).toBe("no_channels_available");
    expect(db.listOccurrences(reminder.id)[0].follow_up_state).toBe("completed");
  });

  it("Mark Paid stops all further follow-up/escalation for the linked reminder", async () => {
    const { db } = await import("../lib/db");
    const { ensureUpcomingCycle } = await import("../lib/scheduling/paymentCycles");
    const { generateReminderForCycle } = await import("../lib/scheduling/paymentReminders");
    const { scanAndProcessDueReminders } = await import("../lib/scheduling/dueScan");

    process.env.VAPID_PUBLIC_KEY = "test-pub";
    process.env.VAPID_PRIVATE_KEY = "test-priv";
    process.env.VAPID_SUBJECT = "mailto:test@example.com";
    const { webpushProvider } = await import("../lib/notifications/providers/webpush");
    const originalSendPush = webpushProvider.sendPush;
    webpushProvider.sendPush = async () => ({ outcome: "sent" as const, detail: "(simulated)" });

    const userId = db.getCurrentUserId();
    const account = db.createPaymentAccount(userId, {
      name: "Test Subscription",
      payment_type: "SUBSCRIPTION",
      issuer: null,
      masked_identifier: null,
      active: true,
      statement_date_rule: 1,
      due_date_rule: "days_after_statement",
      fixed_due_day: null,
      due_days_after_statement: 0,
      default_amount: 9.99,
      minimum_amount: null,
      autopay_enabled: false,
      reminder_enabled: true,
      escalation_enabled: true,
    });
    const cycle = ensureUpcomingCycle(account);
    const reminder = generateReminderForCycle(cycle, account, userId, ["push"], "normal")!;

    const occ = db.listOccurrences(reminder.id)[0];
    const Database = (await import("better-sqlite3")).default;
    const sqlite = new Database(process.env.NOVA_SQLITE_PATH!);
    sqlite
      .prepare(`update reminder_occurrences set scheduled_for = ? where id = ?`)
      .run(new Date(Date.now() - 60_000).toISOString(), occ.id);
    sqlite.close();

    await scanAndProcessDueReminders();
    expect(db.listOccurrences(reminder.id)[0].follow_up_state).toBe("notified");

    db.markPaymentCyclePaid(cycle.id);
    expect(db.listOccurrences(reminder.id)[0].follow_up_state).toBe("completed");

    const before = db.listNotifications(reminder.id).length;
    await scanAndProcessDueReminders();
    const after = db.listNotifications(reminder.id).length;
    expect(after).toBe(before); // no further attempts after Mark Paid

    webpushProvider.sendPush = originalSendPush;
  });

  it("cron-path generation (cycles + reminders) is idempotent across multiple accounts and repeated runs", async () => {
    const { db } = await import("../lib/db");
    const { generateMissingCycles, refreshCycleStatuses } = await import("../lib/scheduling/paymentCycles");
    const { generateMissingReminders } = await import("../lib/scheduling/paymentReminders");

    const userId = db.getCurrentUserId();
    const accounts = [
      { name: "Card A", type: "CREDIT_CARD" as const },
      { name: "Card B", type: "EMI" as const },
      { name: "Card C", type: "BILL" as const },
    ].map((a) =>
      db.createPaymentAccount(userId, {
        name: a.name,
        payment_type: a.type,
        issuer: null,
        masked_identifier: null,
        active: true,
        statement_date_rule: 5,
        due_date_rule: "fixed_day",
        fixed_due_day: 20,
        due_days_after_statement: null,
        default_amount: 100,
        minimum_amount: null,
        autopay_enabled: false,
        reminder_enabled: true,
        escalation_enabled: true,
      })
    );

    // Simulate the cron path running 10 times in a row.
    for (let i = 0; i < 10; i++) {
      generateMissingCycles(userId);
      generateMissingReminders(userId, ["push"], "normal");
      refreshCycleStatuses(userId);
    }

    for (const account of accounts) {
      const cycles = db.listPaymentCycles(account.id);
      expect(cycles).toHaveLength(1); // never duplicated across 10 runs
      expect(cycles[0].reminder_id).toBeTruthy();

      const linkedReminders = db
        .listReminders(userId, { types: ["payment"] })
        .filter((r) => r.id === cycles[0].reminder_id);
      expect(linkedReminders).toHaveLength(1); // exactly one reminder per cycle, never duplicated
    }
  });
});
