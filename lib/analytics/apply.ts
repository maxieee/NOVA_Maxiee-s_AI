import { db } from "@/lib/db";
import type { AnalyticsRecommendationRecord } from "@/types/reminder";

/**
 * The ONLY place a V12 recommendation can mutate real data — and only
 * when explicitly invoked (from a user clicking "Apply" via
 * app/api/analytics/recommendations/[id]/route.ts). It reuses the exact
 * same await db.rescheduleReminder path already used by the rest of the app
 * (e.g. snooze/reschedule flows), never a parallel execution engine.
 */
export async function applyRecommendation(id: string): Promise<AnalyticsRecommendationRecord | null> {
  const states = await db.listRecommendationStates(await db.getCurrentUserId());
  const record = states.find((r) => r.id === id);
  if (!record || record.status !== "pending") return record ?? null;

  const payload = JSON.parse(record.payload) as { kind: string; reminderId?: string; newTime?: string };

  if (payload.kind === "reschedule" && payload.reminderId && payload.newTime) {
    const reminder = await db.getReminder(payload.reminderId);
    if (reminder) {
      await db.rescheduleReminder(reminder.id, reminder.date, payload.newTime);
      await db.addHistory(reminder.id, "updated", `Analytics recommendation applied: default time moved to ${payload.newTime}`);
    }
  }

  return await db.setRecommendationStatus(id, "applied");
}

export async function dismissRecommendation(id: string): Promise<AnalyticsRecommendationRecord | null> {
  return await db.setRecommendationStatus(id, "dismissed");
}
