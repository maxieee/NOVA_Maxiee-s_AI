import { describe, it, expect } from "vitest";
import {
  generateCompletionInsights,
  generateSnoozeInsights,
  generateNotificationInsights,
  generatePaymentInsights,
  generateRecurringInsights,
  MIN_SNOOZE_COUNT,
  MIN_NOTIFICATION_ATTEMPTS_FOR_CHANNEL_FLAG,
} from "../lib/analytics/insights";
import type { CompletionMetrics, SnoozeMetrics, NotificationBreakdown } from "../lib/analytics/metrics";

/**
 * Cheap, explicit guard against psychological/emotional claims: no insight
 * message may contain any of these words. This is intentionally a plain
 * substring check, not NLP — it's meant to catch an accidental regression
 * (e.g. someone later adding "you seem stressed"), not to be a general
 * sentiment classifier.
 */
const BANNED_PHRASES = [
  "stress",
  "anxious",
  "anxiety",
  "disorganiz",
  "lazy",
  "procrastinat",
  "overwhelm",
  "burnout",
  "depress",
  "personality",
  "careless",
  "you seem",
  "you are",
  "you're",
];

function assertNoPsychologicalClaims(messages: string[]) {
  for (const message of messages) {
    const lower = message.toLowerCase();
    for (const phrase of BANNED_PHRASES) {
      expect(lower.includes(phrase), `message "${message}" contains banned phrase "${phrase}"`).toBe(false);
    }
  }
}

describe("generateCompletionInsights", () => {
  it("requires a minimum sample size before reporting a completion rate", () => {
    const tooFew: CompletionMetrics = {
      createdCount: 2,
      completedCount: 1,
      completionRate: 0.5,
      avgTimeToCompletionHours: null,
      overdueCount: 0,
    };
    expect(generateCompletionInsights(tooFew).find((i) => i.id === "completion-rate")).toBeUndefined();

    const enough: CompletionMetrics = {
      createdCount: 5,
      completedCount: 4,
      completionRate: 0.8,
      avgTimeToCompletionHours: 3,
      overdueCount: 0,
    };
    const insights = generateCompletionInsights(enough);
    expect(insights.find((i) => i.id === "completion-rate")).toBeDefined();
    assertNoPsychologicalClaims(insights.map((i) => i.message));
  });
});

describe("generateSnoozeInsights", () => {
  it("does not flag a reminder snoozed below the minimum count", () => {
    const metrics: SnoozeMetrics = {
      totalSnoozes: 1,
      perReminder: [{ reminderId: "r1", title: "Take vitamins", snoozeCount: MIN_SNOOZE_COUNT - 1, resultingHours: [8] }],
      byHourOfDay: new Array(24).fill(0),
    };
    expect(generateSnoozeInsights(metrics)).toHaveLength(0);
  });

  it("flags a reminder at/above the minimum count with a plain factual statement", () => {
    const metrics: SnoozeMetrics = {
      totalSnoozes: MIN_SNOOZE_COUNT,
      perReminder: [{ reminderId: "r1", title: "Take vitamins", snoozeCount: MIN_SNOOZE_COUNT, resultingHours: [8, 8, 9] }],
      byHourOfDay: new Array(24).fill(0),
    };
    const insights = generateSnoozeInsights(metrics);
    expect(insights).toHaveLength(1);
    expect(insights[0].message).toContain("Take vitamins");
    expect(insights[0].message).toContain(String(MIN_SNOOZE_COUNT));
    assertNoPsychologicalClaims(insights.map((i) => i.message));
  });
});

describe("generateNotificationInsights", () => {
  it("requires a minimum attempt count before flagging a channel as never succeeding", () => {
    const tooFew: NotificationBreakdown = {
      byChannel: { sms: { sent: 0, failed: 1, not_configured: 0, invalid_number: 0 } },
      totalsByOutcome: { sent: 0, failed: 1, not_configured: 0, invalid_number: 0 },
      totalAttempts: 1,
    };
    expect(generateNotificationInsights(tooFew)).toHaveLength(0);

    const enough: NotificationBreakdown = {
      byChannel: {
        sms: {
          sent: 0,
          failed: MIN_NOTIFICATION_ATTEMPTS_FOR_CHANNEL_FLAG,
          not_configured: 0,
          invalid_number: 0,
        },
      },
      totalsByOutcome: { sent: 0, failed: MIN_NOTIFICATION_ATTEMPTS_FOR_CHANNEL_FLAG, not_configured: 0, invalid_number: 0 },
      totalAttempts: MIN_NOTIFICATION_ATTEMPTS_FOR_CHANNEL_FLAG,
    };
    const insights = generateNotificationInsights(enough);
    expect(insights).toHaveLength(1);
    assertNoPsychologicalClaims(insights.map((i) => i.message));
  });
});

describe("generatePaymentInsights", () => {
  it("produces nothing when the metric was below the minimum sample (null average)", () => {
    expect(generatePaymentInsights({ sampleSize: 1, avgDaysFromFirstNotificationToPaid: null })).toHaveLength(0);
  });

  it("reports a real average once the sample size requirement is met", () => {
    const insights = generatePaymentInsights({ sampleSize: 3, avgDaysFromFirstNotificationToPaid: 4.2 });
    expect(insights).toHaveLength(1);
    expect(insights[0].message).toContain("3 paid cycles");
    assertNoPsychologicalClaims(insights.map((i) => i.message));
  });
});

describe("generateRecurringInsights", () => {
  it("skips reminders with zero misses and requires enough occurrences", () => {
    const insights = generateRecurringInsights([
      { reminderId: "r1", title: "Water plants", totalOccurrences: 2, missedOccurrences: 1, missRate: 0.5 },
      { reminderId: "r2", title: "Take out trash", totalOccurrences: 4, missedOccurrences: 0, missRate: 0 },
      { reminderId: "r3", title: "Pay rent", totalOccurrences: 4, missedOccurrences: 2, missRate: 0.5 },
    ]);
    expect(insights).toHaveLength(1);
    expect(insights[0].supportingData.reminderId).toBe("r3");
    assertNoPsychologicalClaims(insights.map((i) => i.message));
  });
});
