import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";

/**
 * V12 Analytics — real DataLayer-backed end-to-end metric computation.
 * Follows the os.tmpdir() + beforeAll pre-warm pattern required by this
 * project (see tests/automation-engine.test.ts, tests/proactive-engine.test.ts).
 */
describe("Analytics report — real DB end to end", () => {
  const dbPaths: string[] = [];

  beforeAll(async () => {
    await import("../lib/db");
    await import("../lib/analytics/report");
    await import("../lib/analytics/apply");
  });

  beforeEach(() => {
    vi.resetModules();
    const dbPath = path.join(os.tmpdir(), `nova-analytics-integration-test-${Date.now()}-${Math.random()}.sqlite`);
    dbPaths.push(dbPath);
    process.env.NOVA_SQLITE_PATH = dbPath;
    process.env.NOVA_DATA_SOURCE = "local";
  });

  afterAll(() => {
    for (const p of dbPaths) {
      for (const suffix of ["", "-wal", "-shm"]) {
        try {
          fs.unlinkSync(p + suffix);
        } catch {
          /* ignore */
        }
      }
    }
  });

  it("computes real metrics/insights/recommendations from real persisted activity", async () => {
    const { db } = await import("../lib/db");
    const { buildAnalyticsReport } = await import("../lib/analytics/report");
    const userId = await db.getCurrentUserId();

    // Real activity: a few reminders, some completed.
    const r1 = await db.createReminder(userId, { title: "Water plants", date: "2026-01-01", time: "08:00", priority: "medium", types: ["general"] });
    await db.completeReminder(r1.id);
    const r2 = await db.createReminder(userId, { title: "Call dentist", date: "2026-01-01", time: "10:00", priority: "medium", types: ["call"] });
    await db.completeReminder(r2.id);
    await db.createReminder(userId, { title: "Renew license", date: "2026-01-01", time: "10:00", priority: "low", types: ["general"] });
    await db.createReminder(userId, { title: "Read book", date: "2026-01-01", time: "10:00", priority: "low", types: ["general"] });
    await db.createReminder(userId, { title: "Clean garage", date: "2026-01-01", time: "10:00", priority: "low", types: ["general"] });

    // A reminder snoozed repeatedly.
    const snoozed = await db.createReminder(userId, { title: "Take vitamins", date: "2026-01-01", time: "09:00", priority: "medium", types: ["general"] });
    for (let i = 0; i < 3; i++) await db.snoozeReminder(snoozed.id, 15);

    // A payment account + cycle with mixed notification outcomes, paid.
    const account = await db.createPaymentAccount(userId, {
      name: "Credit card",
      payment_type: "BILL",
      issuer: null,
      masked_identifier: null,
      active: true,
      statement_date_rule: 1,
      due_date_rule: "fixed_day",
      fixed_due_day: 15,
      due_days_after_statement: null,
      default_amount: 100,
      minimum_amount: null,
      autopay_enabled: false,
      reminder_enabled: true,
      escalation_enabled: true,
    });
    const cycle = await db.createPaymentCycle(account.id, {
      cyclePeriod: "2026-01",
      statementDate: "2026-01-01",
      dueDate: "2026-01-15",
      amount: 100,
      minimumAmount: null,
    });
    const paymentReminder = await db.createReminder(userId, {
      title: "Pay credit card",
      date: "2026-01-10",
      time: "09:00",
      priority: "high",
      types: ["payment"],
    });
    await db.linkPaymentCycleReminder(cycle.id, paymentReminder.id);
    const occ = await db.addOccurrence(paymentReminder.id, "2026-01-10T09:00:00.000Z");
    await db.logNotification({ reminderId: paymentReminder.id, occurrenceId: occ.id, channel: "sms", message: "Pay your bill", outcome: "failed" });
    await db.logNotification({ reminderId: paymentReminder.id, occurrenceId: occ.id, channel: "push", message: "Pay your bill", outcome: "sent" });
    await db.markPaymentCyclePaid(cycle.id);

    // 1. Compute real metrics -> at least one real insight.
    const report = await buildAnalyticsReport(userId);
    expect(report.completion.createdCount).toBeGreaterThanOrEqual(5);
    expect(report.completion.completedCount).toBeGreaterThanOrEqual(2);
    expect(report.snooze.perReminder.some((p) => p.reminderId === snoozed.id)).toBe(true);
    expect(report.insights.length).toBeGreaterThan(0);

    // 2. Confirm no underlying data changed as a RESULT of computing insights/recommendations.
    const snoozedReminderAfterReport = (await db.getReminder(snoozed.id))!;
    expect(snoozedReminderAfterReport.status).not.toBe("completed");

    // 3. A qualifying recommendation exists and is pending.
    const rec = report.recommendations.find((r) => r.subjectId === snoozed.id);
    expect(rec).toBeDefined();
    expect(rec!.status).toBe("pending");

    // 4. Explicitly apply it through the real apply path.
    const { applyRecommendation } = await import("../lib/analytics/apply");
    const beforeTime = (await db.getReminder(snoozed.id))!.time;
    await applyRecommendation(rec!.id);
    const afterTime = (await db.getReminder(snoozed.id))!.time;
    expect(afterTime).not.toBe(beforeTime);
    expect(afterTime).toBe(rec!.action.newTime);

    // 5. Recommendation now shows applied and won't reappear.
    const secondReport = await buildAnalyticsReport(userId);
    expect(secondReport.recommendations.find((r) => r.subjectId === snoozed.id)).toBeUndefined();
    const states = await db.listRecommendationStates(userId);
    expect(states.find((s) => s.id === rec!.id)?.status).toBe("applied");
  });
});
