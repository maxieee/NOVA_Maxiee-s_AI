import type { ProactiveEvent, ProactiveRule, ProactiveRuleContext } from "../types";

/** Consecutive missed occurrences of a recurring reminder before flagging it. */
const MISSED_STREAK_THRESHOLD = 2;

/**
 * Fires when a recurring reminder's most recent occurrences were missed
 * back-to-back (status "missed" with no "acknowledged"/"fired" in between),
 * suggesting the recurrence itself may no longer fit the person's routine.
 * Reads reminder_occurrences.status directly (already fetched) — doesn't
 * touch lib/scheduling/recurrence.ts, which only computes NEXT occurrences.
 */
export const recurringMissedRule: ProactiveRule = {
  id: "recurring_missed_streak",
  description: "A recurring reminder has been missed several times in a row.",
  priority: "medium",
  cooldownMinutes: 24 * 60,
  evaluate(ctx: ProactiveRuleContext): ProactiveEvent[] {
    const events: ProactiveEvent[] = [];
    const byReminder = new Map<string, (typeof ctx.occurrences)[number][]>();
    for (const occ of ctx.occurrences) {
      if (!occ.reminder.recurrence) continue;
      const list = byReminder.get(occ.reminder_id) ?? [];
      list.push(occ);
      byReminder.set(occ.reminder_id, list);
    }

    for (const [reminderId, occs] of byReminder) {
      const sorted = [...occs].sort(
        (a, b) => new Date(a.scheduled_for).getTime() - new Date(b.scheduled_for).getTime()
      );
      let streak = 0;
      for (const occ of sorted) {
        if (occ.status === "missed") {
          streak += 1;
        } else if (occ.status === "acknowledged" || occ.status === "fired") {
          streak = 0;
        }
      }
      if (streak >= MISSED_STREAK_THRESHOLD) {
        const reminder = sorted[0].reminder;
        events.push({
          ruleId: recurringMissedRule.id,
          priority: "medium",
          subjectType: "reminder",
          subjectId: reminderId,
          message: `"${reminder.title}" has been missed ${streak} times in a row — want to adjust its schedule?`,
          reminderId,
        });
      }
    }
    return events;
  },
};
