import type { SnoozePattern } from "./metrics";
import { MIN_SNOOZE_COUNT } from "./insights";

/**
 * Recommendation generation. PURE — takes metrics, returns suggestions.
 * Nothing in this file (or anywhere in lib/analytics) ever calls a
 * mutating DataLayer method. A recommendation only becomes real when a
 * human clicks "Apply" in the UI, which calls a separate, explicit apply
 * function (see applyRescheduleRecommendation below and
 * app/api/analytics/recommendations/[id]/route.ts) that goes through the
 * SAME existing db.rescheduleReminder path already used elsewhere in
 * NOVA (e.g. the reminders UI) — analytics never invents a second
 * execution/mutation path.
 */

export type RecommendationType = "reschedule_default_time";

export interface Recommendation {
  /** Deterministic id so re-generating recommendations on every page load matches existing stored decisions. */
  id: string;
  type: RecommendationType;
  subjectType: "reminder";
  subjectId: string;
  title: string;
  message: string;
  action: { kind: "reschedule"; reminderId: string; newTime: string };
}

/** Fraction of a reminder's snoozes that must land in the same hour before we suggest moving its default time there. */
export const MIN_CLUSTER_RATIO = 0.6;

function modeHour(hours: number[]): { hour: number; ratio: number } | null {
  if (hours.length === 0) return null;
  const counts = new Map<number, number>();
  for (const h of hours) counts.set(h, (counts.get(h) ?? 0) + 1);
  let bestHour = hours[0];
  let bestCount = 0;
  for (const [hour, count] of counts) {
    if (count > bestCount) {
      bestHour = hour;
      bestCount = count;
    }
  }
  return { hour: bestHour, ratio: bestCount / hours.length };
}

/**
 * A reminder repeatedly snoozed to roughly the same hour is a concrete,
 * safe, already-supported change: move its default time there. Requires
 * real, sufficiently-sized, sufficiently-consistent data — never applied
 * automatically.
 */
export function computeRescheduleRecommendations(patterns: SnoozePattern[]): Recommendation[] {
  const recs: Recommendation[] = [];

  for (const pattern of patterns) {
    if (pattern.snoozeCount < MIN_SNOOZE_COUNT) continue;
    const mode = modeHour(pattern.resultingHours);
    if (!mode || mode.ratio < MIN_CLUSTER_RATIO) continue;

    const newTime = `${String(mode.hour).padStart(2, "0")}:00`;
    recs.push({
      id: `reschedule_default_time:${pattern.reminderId}`,
      type: "reschedule_default_time",
      subjectType: "reminder",
      subjectId: pattern.reminderId,
      title: `Move "${pattern.title}" to ${newTime}?`,
      message: `You've snoozed "${pattern.title}" ${pattern.snoozeCount} times, usually ending up around ${newTime}. Want NOVA to reschedule it there by default?`,
      action: { kind: "reschedule", reminderId: pattern.reminderId, newTime },
    });
  }

  return recs;
}
