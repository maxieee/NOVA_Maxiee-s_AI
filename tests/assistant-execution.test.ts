import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";

/**
 * V7 execution-layer coverage: proves the assistant pipeline (parse ->
 * validate -> resolve -> execute -> verify -> respond) actually calls the
 * EXISTING DataLayer/business logic and reflects real, persisted state —
 * including honest failure responses that never claim success.
 */
describe("Assistant execution pipeline", () => {
  const dbPaths: string[] = [];

  // One-time warm-up before any scratch DB path is set — see the identical
  // comment in tests/payment-integration.test.ts for why. lib/assistant/pipeline
  // pulls in an even larger module graph (parser, validate, resolveEntity,
  // executeIntent, respond, context, plus lib/db and the scheduling modules
  // executeIntent reuses), so its first-ever import is the most expensive
  // one in the whole suite. Paying that cost here — never touching any
  // file, since lib/db opens its connection lazily on first method call —
  // keeps it out of the first test's 5s testTimeout budget.
  beforeAll(async () => {
    await import("../lib/db");
    await import("../lib/assistant/pipeline");
  });

  beforeEach(() => {
    vi.resetModules();
    const dbPath = path.join(os.tmpdir(), `nova-assistant-exec-test-${Date.now()}-${Math.random()}.sqlite`);
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

  it("creates a real reminder via the existing DataLayer and reports it truthfully", async () => {
    const { handleAssistantMessage } = await import("../lib/assistant/pipeline");
    const { db } = await import("../lib/db");

    const result = await handleAssistantMessage(
      "remind me to call the dentist tomorrow at 10am",
      "test-session-1",
      new Date("2026-09-18T12:00:00")
    );

    expect(result.reply).toMatch(/dentist/i);
    const userId = db.getCurrentUserId();
    const reminders = db.listReminders(userId);
    const created = reminders.find((r) => r.title.toLowerCase().includes("call the dentist"));
    expect(created).toBeTruthy();
    expect(created?.date).toBe("2026-09-19");
    expect(created?.time).toBe("10:00");
  });

  it("snoozes a real reminder and verifies the persisted status before replying", async () => {
    const { handleAssistantMessage } = await import("../lib/assistant/pipeline");
    const { db } = await import("../lib/db");

    const userId = db.getCurrentUserId();
    const reminder = db.createReminder(userId, {
      title: "Dentist call",
      date: "2026-09-19",
      time: "10:00",
      priority: "medium",
      types: ["call"],
    });

    const result = await handleAssistantMessage("snooze the dentist call for 15 minutes", "test-session-2", new Date("2026-09-18T12:00:00"));

    expect(result.reply).toMatch(/snoozed/i);
    const verified = db.getReminder(reminder.id);
    expect(verified?.status).toBe("snoozed");
  });

  it("completes a reminder and reflects real state, never lying on failure", async () => {
    const { handleAssistantMessage } = await import("../lib/assistant/pipeline");
    const { db } = await import("../lib/db");

    const userId = db.getCurrentUserId();
    const reminder = db.createReminder(userId, {
      title: "Submit the quarterly zorbex filing",
      date: "2026-09-18",
      time: "09:00",
      priority: "medium",
      types: ["task"],
    });

    const result = await handleAssistantMessage("mark the zorbex filing as done", "test-session-3", new Date("2026-09-18T12:00:00"));
    expect(result.reply).toMatch(/done/i);
    const verified = db.getReminder(reminder.id);
    expect(verified?.status).toBe("completed");
  });

  it("reports an honest failure (never 'Done!') when the referenced reminder does not exist", async () => {
    const { handleAssistantMessage } = await import("../lib/assistant/pipeline");

    const result = await handleAssistantMessage("mark the nonexistent thing as done", "test-session-4", new Date("2026-09-18T12:00:00"));
    expect(result.reply).not.toMatch(/^done/i);
    expect(result.reply.toLowerCase()).toContain("couldn't find");
  });

  it("QUERY_TODAY summarizes the real buildTodayViewModel output, not a re-implementation", async () => {
    const { handleAssistantMessage } = await import("../lib/assistant/pipeline");
    const { db } = await import("../lib/db");

    const userId = db.getCurrentUserId();
    db.createReminder(userId, {
      title: "Overdue task",
      date: "2026-09-10",
      time: "09:00",
      priority: "medium",
      types: ["task"],
    });

    const result = await handleAssistantMessage("what do I need to do today?", "test-session-5", new Date("2026-09-18T12:00:00"));
    expect(result.reply).toMatch(/needing attention today/i);
    expect(result.reply).toMatch(/overdue/i);
  });

  it("marks a payment cycle paid via the existing dedicated action, and verifies it", async () => {
    const { handleAssistantMessage } = await import("../lib/assistant/pipeline");
    const { db } = await import("../lib/db");
    const { ensureUpcomingCycle } = await import("../lib/scheduling/paymentCycles");

    const userId = db.getCurrentUserId();
    const account = db.createPaymentAccount(userId, {
      name: "Visa Card",
      payment_type: "CREDIT_CARD",
      issuer: "Chase",
      masked_identifier: "•••• 1234",
      active: true,
      statement_date_rule: 1,
      due_date_rule: "fixed_day",
      fixed_due_day: 20,
      due_days_after_statement: null,
      default_amount: 500,
      minimum_amount: 25,
      autopay_enabled: false,
      reminder_enabled: true,
      escalation_enabled: true,
    });
    const cycle = ensureUpcomingCycle(account, new Date("2026-09-18T12:00:00"));

    const result = await handleAssistantMessage("mark the Visa card as paid", "test-session-6", new Date("2026-09-18T12:00:00"));
    expect(result.reply).toMatch(/paid/i);
    const verified = db.getPaymentCycle(cycle.id);
    expect(verified?.status).toBe("paid");
  });

  it("asks for clarification instead of guessing among ambiguous reminder matches", async () => {
    const { handleAssistantMessage } = await import("../lib/assistant/pipeline");
    const { db } = await import("../lib/db");

    const userId = db.getCurrentUserId();
    db.createReminder(userId, { title: "Call the dentist", date: "2026-09-19", time: "10:00", priority: "medium", types: ["call"] });
    db.createReminder(userId, { title: "Call the plumber", date: "2026-09-19", time: "11:00", priority: "medium", types: ["call"] });

    const result = await handleAssistantMessage("snooze the call for 15 minutes", "test-session-7", new Date("2026-09-18T12:00:00"));
    expect(result.reply.toLowerCase()).toMatch(/which one|couldn't find/);
  });

  it("resolves 'it' via short-term session context from the immediately preceding turn", async () => {
    const { handleAssistantMessage } = await import("../lib/assistant/pipeline");
    const { db } = await import("../lib/db");

    await handleAssistantMessage("remind me to water the plants tomorrow at 8am", "test-session-8", new Date("2026-09-18T12:00:00"));
    const result = await handleAssistantMessage("snooze it for 20 minutes", "test-session-8", new Date("2026-09-18T12:05:00"));

    expect(result.reply).toMatch(/snoozed/i);
    const userId = db.getCurrentUserId();
    const reminders = db.listReminders(userId);
    const plants = reminders.find((r) => r.title.toLowerCase().includes("water the plants"));
    expect(plants?.status).toBe("snoozed");
  });

  it("never lets an out-of-allowlist phrase (e.g. delete) reach execution", async () => {
    const { handleAssistantMessage } = await import("../lib/assistant/pipeline");
    const { db } = await import("../lib/db");

    const userId = db.getCurrentUserId();
    const reminder = db.createReminder(userId, { title: "Keep me", date: "2026-09-19", time: "10:00", priority: "medium", types: ["task"] });

    const result = await handleAssistantMessage("delete the keep me reminder", "test-session-9", new Date("2026-09-18T12:00:00"));
    expect(result.reply.toLowerCase()).not.toMatch(/deleted/);
    const stillThere = db.getReminder(reminder.id);
    expect(stillThere).not.toBeNull();
  });
});
