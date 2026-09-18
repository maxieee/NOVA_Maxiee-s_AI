import { db } from "@/lib/db";
import {
  computeCompletionMetrics,
  computeSnoozeMetrics,
  computeNotificationBreakdown,
  computePaymentTimingMetrics,
  computeRecurringMissRates,
  computeProactiveActivity,
  computeAutomationActivity,
} from "./metrics";
import {
  generateCompletionInsights,
  generateSnoozeInsights,
  generateNotificationInsights,
  generatePaymentInsights,
  generateRecurringInsights,
  type Insight,
} from "./insights";
import { computeRescheduleRecommendations, type Recommendation } from "./recommendations";
import type { AnalyticsRecommendationStatus } from "@/types/reminder";

/** Bounded lookback window — never scans the full history table unbounded. */
export const ANALYTICS_WINDOW_DAYS = 90;

export interface RecommendationWithStatus extends Recommendation {
  status: AnalyticsRecommendationStatus;
}

export interface AnalyticsReport {
  windowDays: number;
  completion: ReturnType<typeof computeCompletionMetrics>;
  snooze: ReturnType<typeof computeSnoozeMetrics>;
  notifications: ReturnType<typeof computeNotificationBreakdown>;
  paymentTiming: ReturnType<typeof computePaymentTimingMetrics>;
  recurringMissRates: ReturnType<typeof computeRecurringMissRates>;
  proactiveActivity: ReturnType<typeof computeProactiveActivity>;
  automationActivity: ReturnType<typeof computeAutomationActivity>;
  insights: Insight[];
  recommendations: RecommendationWithStatus[];
}

/**
 * The one thin orchestration layer: fetches bounded, already-persisted
 * data via the DataLayer and hands it to pure functions. This function
 * itself never mutates anything except persisting NEW pending
 * recommendation rows the first time a qualifying pattern is seen
 * (ensureRecommendation is an insert-if-absent — it never touches a row a
 * human already applied or dismissed).
 */
export function buildAnalyticsReport(userId: string, now: Date = new Date()): AnalyticsReport {
  const since = new Date(now.getTime() - ANALYTICS_WINDOW_DAYS * 86_400_000).toISOString();
  const snapshot = db.getAnalyticsSnapshot(userId, since);

  const completion = computeCompletionMetrics(snapshot.reminders, now);
  const snooze = computeSnoozeMetrics(snapshot.reminders, snapshot.occurrences, snapshot.history);
  const notifications = computeNotificationBreakdown(snapshot.notifications);
  const paymentTiming = computePaymentTimingMetrics(snapshot.paymentCycles, snapshot.notifications);
  const recurringMissRates = computeRecurringMissRates(snapshot.reminders, snapshot.occurrences);
  const proactiveActivity = computeProactiveActivity(snapshot.proactiveNotifications);
  const automationActivity = computeAutomationActivity(snapshot.automationRuns);

  const insights: Insight[] = [
    ...generateCompletionInsights(completion),
    ...generateSnoozeInsights(snooze),
    ...generateNotificationInsights(notifications),
    ...generatePaymentInsights(paymentTiming),
    ...generateRecurringInsights(recurringMissRates),
  ];

  const rawRecommendations = computeRescheduleRecommendations(snooze.perReminder);

  const existingStates = new Map(db.listRecommendationStates(userId).map((r) => [r.id, r]));
  const recommendations: RecommendationWithStatus[] = [];
  for (const rec of rawRecommendations) {
    const existing = existingStates.get(rec.id);
    if (!existing) {
      db.ensureRecommendation(userId, rec.id, {
        type: rec.type,
        subjectType: rec.subjectType,
        subjectId: rec.subjectId,
        payload: JSON.stringify(rec.action),
      });
    }
    const status = existing?.status ?? "pending";
    // Don't keep showing a recommendation the user already dismissed or applied.
    if (status === "pending") {
      recommendations.push({ ...rec, status });
    }
  }

  return {
    windowDays: ANALYTICS_WINDOW_DAYS,
    completion,
    snooze,
    notifications,
    paymentTiming,
    recurringMissRates,
    proactiveActivity,
    automationActivity,
    insights,
    recommendations,
  };
}
