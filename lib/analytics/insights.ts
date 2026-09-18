import type {
  CompletionMetrics,
  SnoozeMetrics,
  NotificationBreakdown,
  PaymentTimingMetrics,
  RecurringMissRate,
} from "./metrics";
import { MIN_PAYMENT_TIMING_SAMPLE } from "./metrics";

/**
 * Insight generation — strictly observational, plain statistical
 * statements about THIS user's own recorded NOVA usage. No psychological
 * claims, no inferred traits, no correlation presented as causation. Each
 * insight below requires a minimum real sample size (documented per rule)
 * before it is generated, so NOVA never manufactures a "pattern" from too
 * little data (e.g. never calling a single snooze or a single payment a
 * "usual" behavior).
 */

export type InsightCategory =
  | "completion"
  | "snooze"
  | "notification"
  | "payment"
  | "recurring"
  | "proactive"
  | "automation";

export type InsightSeverity = "info" | "notice" | "warning";

export interface Insight {
  id: string;
  category: InsightCategory;
  message: string;
  severity: InsightSeverity;
  supportingData: Record<string, unknown>;
}

/** A reminder must be snoozed at least this many times in the window before it's called out. */
export const MIN_SNOOZE_COUNT = 3;
/** A notification channel must have this many attempts before "never succeeded" is reported. */
export const MIN_NOTIFICATION_ATTEMPTS_FOR_CHANNEL_FLAG = 3;
/** A recurring reminder needs this many recorded occurrences before a miss rate is reported (mirrors metrics.ts). */
export const MIN_OCCURRENCES_FOR_MISS_RATE_INSIGHT = 3;

export function generateCompletionInsights(metrics: CompletionMetrics): Insight[] {
  const insights: Insight[] = [];

  if (metrics.createdCount >= 5 && metrics.completionRate !== null) {
    insights.push({
      id: "completion-rate",
      category: "completion",
      message: `You completed ${metrics.completedCount} of ${metrics.createdCount} reminders in this window (${Math.round(
        metrics.completionRate * 100
      )}%).`,
      severity: "info",
      supportingData: { createdCount: metrics.createdCount, completedCount: metrics.completedCount },
    });
  }

  if (metrics.avgTimeToCompletionHours !== null && metrics.completedCount >= 3) {
    const hours = metrics.avgTimeToCompletionHours;
    insights.push({
      id: "avg-completion-time",
      category: "completion",
      message:
        hours < 24
          ? `You typically mark reminders complete about ${hours.toFixed(1)} hours after creating them.`
          : `You typically mark reminders complete about ${(hours / 24).toFixed(1)} days after creating them.`,
      severity: "info",
      supportingData: { avgTimeToCompletionHours: hours },
    });
  }

  if (metrics.overdueCount >= 3) {
    insights.push({
      id: "overdue-count",
      category: "completion",
      message: `You currently have ${metrics.overdueCount} reminders past their scheduled time.`,
      severity: "notice",
      supportingData: { overdueCount: metrics.overdueCount },
    });
  }

  return insights;
}

export function generateSnoozeInsights(metrics: SnoozeMetrics): Insight[] {
  const insights: Insight[] = [];

  for (const pattern of metrics.perReminder) {
    if (pattern.snoozeCount < MIN_SNOOZE_COUNT) continue;
    insights.push({
      id: `snooze-${pattern.reminderId}`,
      category: "snooze",
      message: `You've snoozed "${pattern.title}" ${pattern.snoozeCount} times in this window.`,
      severity: "notice",
      supportingData: { reminderId: pattern.reminderId, snoozeCount: pattern.snoozeCount },
    });
  }

  return insights;
}

export function generateNotificationInsights(breakdown: NotificationBreakdown): Insight[] {
  const insights: Insight[] = [];

  for (const [channel, outcomes] of Object.entries(breakdown.byChannel)) {
    const total = outcomes.sent + outcomes.failed + outcomes.not_configured + outcomes.invalid_number;
    if (total < MIN_NOTIFICATION_ATTEMPTS_FOR_CHANNEL_FLAG) continue;
    if (outcomes.sent === 0) {
      insights.push({
        id: `channel-never-sent-${channel}`,
        category: "notification",
        message: `Your "${channel}" channel has been attempted ${total} times in this window and has not successfully sent once.`,
        severity: "warning",
        supportingData: { channel, ...outcomes },
      });
    }
  }

  return insights;
}

export function generatePaymentInsights(metrics: PaymentTimingMetrics): Insight[] {
  if (metrics.avgDaysFromFirstNotificationToPaid === null) return [];
  return [
    {
      id: "payment-timing",
      category: "payment",
      message: `Across ${metrics.sampleSize} paid cycles, you typically paid about ${metrics.avgDaysFromFirstNotificationToPaid.toFixed(
        1
      )} days after the first payment reminder.`,
      severity: "info",
      supportingData: { sampleSize: metrics.sampleSize },
    },
  ];
}

export function generateRecurringInsights(missRates: RecurringMissRate[]): Insight[] {
  const insights: Insight[] = [];
  for (const m of missRates) {
    if (m.totalOccurrences < MIN_OCCURRENCES_FOR_MISS_RATE_INSIGHT) continue;
    if (m.missRate <= 0) continue;
    insights.push({
      id: `recurring-miss-${m.reminderId}`,
      category: "recurring",
      message: `"${m.title}" was missed ${m.missedOccurrences} of ${m.totalOccurrences} recorded times (${Math.round(
        m.missRate * 100
      )}%).`,
      severity: m.missRate >= 0.4 ? "warning" : "notice",
      supportingData: { reminderId: m.reminderId, missRate: m.missRate },
    });
  }
  return insights;
}

/** Below-threshold cases are intentionally silent — proves no false pattern is manufactured from n=1/2. */
export function assertBelowThresholdSampleSizes() {
  return { MIN_SNOOZE_COUNT, MIN_NOTIFICATION_ATTEMPTS_FOR_CHANNEL_FLAG, MIN_PAYMENT_TIMING_SAMPLE };
}
