import type { ProactiveEvent, ProactiveRule, ProactiveRuleContext } from "../types";

/** Repeatedly ignored: several notification attempts sent with no acknowledgement yet. */
const IGNORED_ATTEMPT_THRESHOLD = 3;

export const reminderIgnoredRule: ProactiveRule = {
  id: "reminder_repeatedly_ignored",
  description: "A reminder has been notified several times with no acknowledgement.",
  priority: "high",
  cooldownMinutes: 6 * 60,
  evaluate(ctx: ProactiveRuleContext): ProactiveEvent[] {
    const events: ProactiveEvent[] = [];
    for (const occ of ctx.occurrences) {
      if (occ.follow_up_state === "completed" || occ.follow_up_state === "cancelled") continue;
      if (occ.notification_attempt_count < IGNORED_ATTEMPT_THRESHOLD) continue;
      events.push({
        ruleId: reminderIgnoredRule.id,
        priority: "high",
        subjectType: "reminder",
        subjectId: occ.reminder_id,
        message: `"${occ.reminder.title}" has been notified ${occ.notification_attempt_count} times with no response — it may need your attention.`,
        reminderId: occ.reminder_id,
      });
    }
    return events;
  },
};
