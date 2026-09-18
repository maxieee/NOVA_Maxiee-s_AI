import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { derivePaymentCycleStatus } from "@/lib/scheduling/paymentCycles";

describe("derivePaymentCycleStatus — pure derivation from due_date vs now", () => {
  const now = new Date("2026-06-15T12:00:00.000Z");

  it("overdue when due_date is in the past", () => {
    expect(derivePaymentCycleStatus("2026-06-10", now)).toBe("overdue");
  });

  it("due_today when due_date is today", () => {
    expect(derivePaymentCycleStatus("2026-06-15", now)).toBe("due_today");
  });

  it("due_soon within the lookahead window", () => {
    expect(derivePaymentCycleStatus("2026-06-20", now)).toBe("due_soon");
  });

  it("upcoming beyond the lookahead window", () => {
    expect(derivePaymentCycleStatus("2026-07-15", now)).toBe("upcoming");
  });

  it("never overrides an already-'paid' status, regardless of due_date", () => {
    expect(derivePaymentCycleStatus("2026-06-01", now, "paid")).toBe("paid");
  });
});

describe("payment_accounts / payment_cycles — DataLayer + cycle generation", () => {
  const dbPaths: string[] = [];

  // local.ts caches a module-level sqlite connection, so each test gets its
  // own isolated database by resetting the module registry AND pointing
  // NOVA_SQLITE_PATH at a brand-new scratch file before importing "../lib/db".
  beforeEach(() => {
    vi.resetModules();
    // OS temp dir, not process.cwd() — see payment-integration.test.ts for why
    // (cwd can be inside a cloud-synced folder like OneDrive on Windows).
    const dbPath = path.join(os.tmpdir(), `nova-payment-cycles-test-${Date.now()}-${Math.random()}.sqlite`);
    dbPaths.push(dbPath);
    process.env.NOVA_SQLITE_PATH = dbPath;
    process.env.NOVA_DATA_SOURCE = "local";
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

  it("creates a payment account with sane defaults and no duplicate-per-period cycles", async () => {
    const { db } = await import("../lib/db");
    const { ensureUpcomingCycle } = await import("../lib/scheduling/paymentCycles");
    const userId = db.getCurrentUserId();

    const account = db.createPaymentAccount(userId, {
      name: "Visa Platinum",
      payment_type: "CREDIT_CARD",
      issuer: "Chase",
      masked_identifier: "Visa •••• 1234",
      active: true,
      statement_date_rule: 5,
      due_date_rule: "fixed_day",
      fixed_due_day: 25,
      due_days_after_statement: null,
      default_amount: 250,
      minimum_amount: 25,
      autopay_enabled: false,
      reminder_enabled: true,
      escalation_enabled: true,
    });

    expect(account.masked_identifier).toBe("Visa •••• 1234");

    const now = new Date();
    const cycle1 = ensureUpcomingCycle(account, now);
    const cycle2 = ensureUpcomingCycle(account, now);
    const cycle3 = ensureUpcomingCycle(account, new Date(now.getTime() + 1000)); // a moment later, same period

    // Idempotent: repeated calls for the same period return the SAME row,
    // never a duplicate.
    expect(cycle2.id).toBe(cycle1.id);
    expect(cycle3.id).toBe(cycle1.id);
    expect(db.listPaymentCycles(account.id)).toHaveLength(1);
  });

  it("disabling an account stops it from being picked up by generateMissingCycles", async () => {
    const { db } = await import("../lib/db");
    const { generateMissingCycles } = await import("../lib/scheduling/paymentCycles");
    const userId = db.getCurrentUserId();

    const account = db.createPaymentAccount(userId, {
      name: "Netflix",
      payment_type: "SUBSCRIPTION",
      issuer: null,
      masked_identifier: null,
      active: true,
      statement_date_rule: 1,
      due_date_rule: "days_after_statement",
      fixed_due_day: null,
      due_days_after_statement: 0,
      default_amount: 15.99,
      minimum_amount: null,
      autopay_enabled: true,
      reminder_enabled: true,
      escalation_enabled: false,
    });

    db.setPaymentAccountActive(account.id, false);
    generateMissingCycles(userId);
    expect(db.listPaymentCycles(account.id)).toHaveLength(0);
  });

  it("Mark Paid is idempotent and completes the linked reminder via the existing completeReminder path", async () => {
    const { db } = await import("../lib/db");
    const { ensureUpcomingCycle } = await import("../lib/scheduling/paymentCycles");
    const { generateReminderForCycle } = await import("../lib/scheduling/paymentReminders");
    const userId = db.getCurrentUserId();

    const account = db.createPaymentAccount(userId, {
      name: "Gym EMI",
      payment_type: "EMI",
      issuer: null,
      masked_identifier: null,
      active: true,
      statement_date_rule: 1,
      due_date_rule: "fixed_day",
      fixed_due_day: 10,
      due_days_after_statement: null,
      default_amount: 100,
      minimum_amount: null,
      autopay_enabled: false,
      reminder_enabled: true,
      escalation_enabled: true,
    });

    const cycle = ensureUpcomingCycle(account);
    const reminder = generateReminderForCycle(cycle, account, userId, ["push"], "normal");
    expect(reminder).not.toBeNull();
    expect(db.getPaymentCycle(cycle.id)?.reminder_id).toBe(reminder!.id);

    const paid1 = db.markPaymentCyclePaid(cycle.id);
    expect(paid1?.status).toBe("paid");
    expect(db.getReminder(reminder!.id)?.status).toBe("completed");

    // Idempotent: a second Mark Paid call is a no-op, not an error.
    const paid2 = db.markPaymentCyclePaid(cycle.id);
    expect(paid2?.status).toBe("paid");
    expect(paid2?.paid_at).toBe(paid1?.paid_at);
  });

  it("generateReminderForCycle is idempotent per cycle (re-running never creates a second reminder)", async () => {
    const { db } = await import("../lib/db");
    const { ensureUpcomingCycle } = await import("../lib/scheduling/paymentCycles");
    const { generateReminderForCycle, generateMissingReminders } = await import("../lib/scheduling/paymentReminders");
    const userId = db.getCurrentUserId();

    const account = db.createPaymentAccount(userId, {
      name: "Electric Bill",
      payment_type: "BILL",
      issuer: null,
      masked_identifier: null,
      active: true,
      statement_date_rule: 1,
      due_date_rule: "days_after_statement",
      fixed_due_day: null,
      due_days_after_statement: 14,
      default_amount: 60,
      minimum_amount: null,
      autopay_enabled: false,
      reminder_enabled: true,
      escalation_enabled: true,
    });

    const cycle = ensureUpcomingCycle(account);
    const r1 = generateReminderForCycle(cycle, account, userId, ["push"], "normal");
    generateMissingReminders(userId, ["push"], "normal");
    generateMissingReminders(userId, ["push"], "normal");

    // Seed data may already contain unrelated ad-hoc "payment" reminders —
    // what matters is exactly one reminder is linked to THIS cycle.
    const remindersForUser = db.listReminders(userId, { types: ["payment"] });
    expect(remindersForUser.filter((r) => r.id === r1!.id)).toHaveLength(1);
    expect(db.getPaymentCycle(cycle.id)?.reminder_id).toBe(r1!.id);
  });
});
