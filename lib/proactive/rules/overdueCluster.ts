import { getUrgency } from "@/lib/scheduling/urgency";
import type { ProactiveEvent, ProactiveRule, ProactiveRuleContext } from "../types";

/** How many simultaneously-overdue reminders counts as "piling up". */
const CLUSTER_THRESHOLD = 3;

/**
 * Fires ONE event when several items are overdue at once, instead of one
 * event per reminder — deliberately different from reminderIgnored/paymentOverdue,
 * which are per-subject, so a bad day doesn't turn into a notification storm.
 */
export const overdueClusterRule: ProactiveRule = {
  id: "overdue_cluster",
  description: "Multiple reminders are overdue at the same time.",
  priority: "high",
  cooldownMinutes: 4 * 60,
  evaluate(ctx: ProactiveRuleContext): ProactiveEvent[] {
    const overdue = ctx.reminders.filter((r) => getUrgency(r, ctx.now) === "overdue");
    if (overdue.length < CLUSTER_THRESHOLD) return [];
    return [
      {
        ruleId: overdueClusterRule.id,
        priority: "high",
        subjectType: "cluster",
        // A stable subject key (not tied to any one reminder) so the
        // cooldown dedupes across evaluations regardless of which specific
        // reminders make up the cluster on a given run.
        subjectId: "overdue_cluster",
        message: `You have ${overdue.length} overdue items piling up: ${overdue
          .slice(0, 3)
          .map((r) => `"${r.title}"`)
          .join(", ")}${overdue.length > 3 ? ", and more" : ""}.`,
      },
    ];
  },
};
