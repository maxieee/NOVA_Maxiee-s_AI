import type { ProactiveEvent, ProactiveRule, ProactiveRuleContext } from "../types";

/** Fires while a payment cycle is overdue and unpaid. */
export const paymentOverdueRule: ProactiveRule = {
  id: "payment_overdue",
  description: "A payment is overdue and still unpaid.",
  priority: "urgent",
  cooldownMinutes: 12 * 60,
  evaluate(ctx: ProactiveRuleContext): ProactiveEvent[] {
    const events: ProactiveEvent[] = [];
    for (const { account, cycle } of ctx.paymentCycles) {
      if (cycle.status !== "overdue") continue;
      events.push({
        ruleId: paymentOverdueRule.id,
        priority: "urgent",
        subjectType: "payment_cycle",
        subjectId: cycle.id,
        message: `${account.name} payment of ${cycle.amount} is overdue (was due ${cycle.due_date}).`,
        reminderId: cycle.reminder_id ?? undefined,
      });
    }
    return events;
  },
};
