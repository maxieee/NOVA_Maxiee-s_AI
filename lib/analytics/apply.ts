import { db } from "@/lib/db";
import type { AnalyticsRecommendationRecord } from "@/types/reminder";

/**
 * The ONLY place a V12 recommendation can mutate real data — and only
 * when explicitly invoked (from a user clicking "Apply" via
 * app/api/analytics/recommendations/[id]/route.ts). It reuses the exact
 * same db.rescheduleReminder path already used by the rest of the app
 * (e.g. snooze/reschedule flows), never a parallel execution engine.
 */
export function applyRecommendation(id: string): AnalyticsRecommendationRecord | null {
  const states = db.listRecommendationStates(db.getCurrentUserId());
  const record = states.find((r) => r.id === id);
  if (!record || record.status !== "pending") return record ?? null;

  const payload = JSON.parse(record.payload) as { kind: string; reminderId?: string; newTime?: string };

  if (payload.kind === "reschedule" && payload.reminderId && payload.newTime) {
    const reminder = db.getReminder(payload.reminderId);
    if (reminder) {
      db.rescheduleReminder(reminder.id, reminder.date, payload.newTime);
      db.addHistory(reminder.id, "updated", `Analytics recommendation applied: default time moved to ${payload.newTime}`);
    }
  }

  return db.setRecommendationStatus(id, "applied");
}

export function dismissRecommendation(id: string): AnalyticsRecommendationRecord | null {
  return db.setRecommendationStatus(id, "dismissed");
}
