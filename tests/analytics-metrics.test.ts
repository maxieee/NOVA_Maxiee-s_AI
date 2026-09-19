import { describe, it, expect } from "vitest";
import {
  computeCompletionMetrics,
  computeSnoozeMetrics,
  computeNotificationBreakdown,
  computePaymentTimingMetrics,
  computeRecurringMissRates,
  computeProactiveActivity,
  computeAutomationActivity,
  MIN_PAYMENT_TIMING_SAMPLE,
  MIN_OCCURRENCES_FOR_MISS_RATE,
} from "../lib/analytics/metrics";
import type { Reminder, ReminderOccurrence, ReminderHistoryEntry, NotificationLogEntry, PaymentCycle } from "../types/reminder";

function reminder(overrides: Partial<Reminder> = {}): Reminder {
  return {
    id: "r1",
    user_id: "u1",
    title: "Take vitamins",
    description: null,
    date: "2026-01-01",
    time: "09:00",
    priority: "medium",
    notes: null,
    status: "created",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    completed_at: null,
    types: [],
    ...overrides,
  } as Reminder;
}

describe("computeCompletionMetrics", () => {
  it("computes creation/completion counts and rate from real data only", () => {
    const reminders = [
      reminder({ id: "r1", status: "completed", created_at: "2026-01-01T00:00:00.000Z", completed_at: "2026-01-01T02:00:00.000Z" }),
      reminder({ id: "r2", status: "completed", created_at: "2026-01-01T00:00:00.000Z", completed_at: "2026-01-01T04:00:00.000Z" }),
      reminder({ id: "r3", status: "created" }),
    ];
    const metrics = computeCompletionMetrics(reminders, new Date("2026-01-05T00:00:00.000Z"));
    expect(metrics.createdCount).toBe(3);
    expect(metrics.completedCount).toBe(2);
    expect(metrics.completionRate).toBeCloseTo(2 / 3);
    expect(metrics.avgTimeToCompletionHours).toBeCloseTo(3);
  });

  it("never divides by zero — null rate when nothing was created", () => {
    const metrics = computeCompletionMetrics([], new Date());
    expect(metrics.createdCount).toBe(0);
    expect(metrics.completionRate).toBeNull();
    expect(metrics.avgTimeToCompletionHours).toBeNull();
  });
});

describe("computeSnoozeMetrics", () => {
  it("tallies snooze history per reminder and by resulting hour", () => {
    const reminders = [reminder({ id: "r1" })];
    // No trailing "Z" here either: computeSnoozeMetrics compares this
    // against scheduled_for's naive-local time via `.getTime()` to find the
    // occurrence a snooze produced. Mixing an absolute-UTC created_at with
    // a naive-local scheduled_for would make that `>=` comparison itself
    // timezone-dependent (in production the server's own clock is always
    // UTC, so this never surfaces there — but it would in a non-UTC test
    // runner). Keeping both fixture values in the same naive convention
    // makes the relative ordering correct regardless of the runner's TZ.
    const history: ReminderHistoryEntry[] = [
      { id: "h1", reminder_id: "r1", action: "snoozed", detail: "15m", created_at: "2026-01-01T08:00:00.000" },
      { id: "h2", reminder_id: "r1", action: "snoozed", detail: "15m", created_at: "2026-01-01T08:20:00.000" },
    ];
    const occurrences: ReminderOccurrence[] = [
      {
        id: "o1",
        reminder_id: "r1",
        // No trailing "Z": reminder_occurrences.scheduled_for is always a
        // naive local wall-clock string in production (lib/db/local.ts's
        // `${date}T${time}:00`, never a UTC-suffixed instant), and
        // computeSnoozeMetrics reads it back with `.getHours()` (also
        // local). Anchoring this fixture to explicit UTC only matched
        // "hour 8" on a machine whose local timezone happens to be UTC.
        scheduled_for: "2026-01-01T08:15:00.000",
        status: "pending",
        repeat_count: 0,
        escalated: false,
        follow_up_state: "pending",
        notification_attempt_count: 0,
        escalation_level: 0,
      },
      {
        id: "o2",
        reminder_id: "r1",
        scheduled_for: "2026-01-01T08:35:00.000",
        status: "pending",
        repeat_count: 0,
        escalated: false,
        follow_up_state: "pending",
        notification_attempt_count: 0,
        escalation_level: 0,
      },
    ];
    const metrics = computeSnoozeMetrics(reminders, occurrences, history);
    expect(metrics.totalSnoozes).toBe(2);
    expect(metrics.perReminder[0].snoozeCount).toBe(2);
    expect(metrics.byHourOfDay[8]).toBe(2);
  });
});

describe("computeNotificationBreakdown", () => {
  it("tallies outcomes by channel and overall", () => {
    const notifications: NotificationLogEntry[] = [
      { id: "n1", reminder_id: "r1", occurrence_id: "o1", sent_at: "2026-01-01T00:00:00.000Z", channel: "sms", outcome: "failed", message: "x" },
      { id: "n2", reminder_id: "r1", occurrence_id: "o1", sent_at: "2026-01-01T00:00:00.000Z", channel: "sms", outcome: "failed", message: "x" },
      { id: "n3", reminder_id: "r1", occurrence_id: "o1", sent_at: "2026-01-01T00:00:00.000Z", channel: "push", outcome: "sent", message: "x" },
    ];
    const breakdown = computeNotificationBreakdown(notifications);
    expect(breakdown.byChannel.sms.failed).toBe(2);
    expect(breakdown.byChannel.push.sent).toBe(1);
    expect(breakdown.totalsByOutcome.failed).toBe(2);
    expect(breakdown.totalAttempts).toBe(3);
  });
});

describe("computePaymentTimingMetrics", () => {
  it("requires a minimum sample size before reporting a pattern", () => {
    const cycle = (id: string, paidAt: string): PaymentCycle => ({
      id,
      payment_account_id: "a1",
      cycle_period: "2026-01",
      statement_date: "2026-01-01",
      due_date: "2026-01-10",
      amount: 100,
      minimum_amount: null,
      status: "paid",
      paid_at: paidAt,
      reminder_id: "r1",
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
    });
    const notif = (id: string, sentAt: string): NotificationLogEntry => ({
      id,
      reminder_id: "r1",
      occurrence_id: "o1",
      sent_at: sentAt,
      channel: "push",
      outcome: "sent",
      message: "x",
    });

    // Only 1 sample — below MIN_PAYMENT_TIMING_SAMPLE — must NOT report a pattern.
    const belowThreshold = computePaymentTimingMetrics([cycle("c1", "2026-01-05T00:00:00.000Z")], [notif("n1", "2026-01-01T00:00:00.000Z")]);
    expect(belowThreshold.sampleSize).toBe(1);
    expect(belowThreshold.avgDaysFromFirstNotificationToPaid).toBeNull();

    // Enough samples — reports the real average.
    const cycles = [
      cycle("c1", "2026-01-05T00:00:00.000Z"),
      cycle("c2", "2026-01-05T00:00:00.000Z"),
      cycle("c3", "2026-01-05T00:00:00.000Z"),
    ];
    const notifications = [notif("n1", "2026-01-01T00:00:00.000Z")];
    const metrics = computePaymentTimingMetrics(cycles, notifications);
    expect(metrics.sampleSize).toBe(MIN_PAYMENT_TIMING_SAMPLE);
    expect(metrics.avgDaysFromFirstNotificationToPaid).toBeCloseTo(4);
  });
});

describe("computeRecurringMissRates", () => {
  it("requires a minimum number of recorded occurrences", () => {
    const reminders = [reminder({ id: "r1" })];
    const occ = (status: ReminderOccurrence["status"], i: number): ReminderOccurrence => ({
      id: `o${i}`,
      reminder_id: "r1",
      scheduled_for: `2026-01-0${i}T00:00:00.000Z`,
      status,
      repeat_count: 0,
      escalated: false,
      follow_up_state: "pending",
      notification_attempt_count: 0,
      escalation_level: 0,
    });

    const belowThreshold = computeRecurringMissRates(reminders, [occ("missed", 1), occ("fired", 2)]);
    expect(belowThreshold).toHaveLength(0);

    const enough = computeRecurringMissRates(reminders, [occ("missed", 1), occ("fired", 2), occ("fired", 3)]);
    expect(enough).toHaveLength(1);
    expect(enough[0].totalOccurrences).toBeGreaterThanOrEqual(MIN_OCCURRENCES_FOR_MISS_RATE);
    expect(enough[0].missRate).toBeCloseTo(1 / 3);
  });
});

describe("computeProactiveActivity / computeAutomationActivity", () => {
  it("tallies by rule and by automation", () => {
    const proactive = computeProactiveActivity([
      { id: "p1", user_id: "u1", rule_id: "overdue_payment", subject_type: "payment_cycle", subject_id: "c1", priority: "high", channel: "push", message: "x", outcome: "sent", fired_at: "2026-01-01" },
      { id: "p2", user_id: "u1", rule_id: "overdue_payment", subject_type: "payment_cycle", subject_id: "c2", priority: "high", channel: "push", message: "x", outcome: "sent", fired_at: "2026-01-02" },
    ]);
    expect(proactive.totalFired).toBe(2);
    expect(proactive.byRule.overdue_payment).toBe(2);

    const automation = computeAutomationActivity([
      { id: "a1", automation_id: "auto1", automation_name: "Daily digest", triggered_at: "2026-01-01", trigger_context: null, outcome: "success", detail: null, created_at: "2026-01-01" },
      { id: "a2", automation_id: "auto1", automation_name: "Daily digest", triggered_at: "2026-01-02", trigger_context: null, outcome: "failed", detail: null, created_at: "2026-01-02" },
    ]);
    expect(automation.totalRuns).toBe(2);
    expect(automation.byOutcome.success).toBe(1);
    expect(automation.byAutomation[0].runs).toBe(2);
    expect(automation.byAutomation[0].successes).toBe(1);
  });
});
