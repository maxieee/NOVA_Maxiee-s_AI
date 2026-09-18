import { getUrgency } from "@/lib/scheduling/urgency";
import type { ProactiveEvent, ProactiveRule, ProactiveRuleContext } from "../types";

/** How soon (minutes) counts as "approaching" for a high/urgent-priority reminder. */
const APPROACHING_WINDOW_MINUTES = 120;

export const reminderApproachingRule: ProactiveRule = {
  id: "important_reminder_approaching",
  description: "An urgent/high-priority reminder is coming up soon.",
  priority: "high",
  cooldownMinutes: 60,
  evaluate(ctx: ProactiveRuleContext): ProactiveEvent[] {
    const events: ProactiveEvent[] = [];
    for (const r of ctx.reminders) {
      if (r.priority !== "urgent" && r.priority !== "high") continue;
      if (r.status === "completed" || r.status === "cancelled") continue;
      const urgency = getUrgency(r, ctx.now);
      if (urgency === "completed" || urgency === "overdue") continue;

      const dueAt = new Date(`${r.date}T${r.time ?? "23:59"}:00`).getTime();
      const minutesUntil = (dueAt - ctx.now.getTime()) / 60_000;
      if (minutesUntil < 0 || minutesUntil > APPROACHING_WINDOW_MINUTES) continue;

      // Only proactively flag it before NOVA's own reminder engine has ever
      // notified for it — once it's actively notifying/escalating, that
      // engine (not this one) is already the loud channel.
      if (r.status === "notified") continue;

      events.push({
        ruleId: reminderApproachingRule.id,
        priority: r.priority === "urgent" ? "urgent" : "high",
        subjectType: "reminder",
        subjectId: r.id,
        message: `"${r.title}" (${r.priority}) is coming up in about ${Math.max(1, Math.round(minutesUntil))} minutes.`,
        reminderId: r.id,
      });
    }
    return events;
  },
};
