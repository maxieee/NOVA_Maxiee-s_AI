import type { ProactiveEvent, ProactiveRule, ProactiveRuleContext } from "../types";

/**
 * Fires once a payment cycle enters "due_soon" or "due_today" (see
 * lib/scheduling/paymentCycles.ts#derivePaymentCycleStatus — status is
 * never recomputed here, only read).
 */
export const paymentDueSoonRule: ProactiveRule = {
  id: "payment_due_soon",
  description: "A payment is due soon or due today.",
  priority: "medium",
  cooldownMinutes: 24 * 60,
  evaluate(ctx: ProactiveRuleContext): ProactiveEvent[] {
    const events: ProactiveEvent[] = [];
    for (const { account, cycle } of ctx.paymentCycles) {
      if (cycle.status !== "due_soon" && cycle.status !== "due_today") continue;
      const when = cycle.status === "due_today" ? "today" : `on ${cycle.due_date}`;
      events.push({
        ruleId: paymentDueSoonRule.id,
        priority: cycle.status === "due_today" ? "high" : "medium",
        subjectType: "payment_cycle",
        subjectId: cycle.id,
        message: `${account.name} payment of ${cycle.amount} is due ${when}.`,
        reminderId: cycle.reminder_id ?? undefined,
      });
    }
    return events;
  },
};
