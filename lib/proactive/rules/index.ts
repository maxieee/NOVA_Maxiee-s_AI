import type { ProactiveRule } from "../types";
import { paymentDueSoonRule } from "./paymentDueSoon";
import { paymentOverdueRule } from "./paymentOverdue";
import { reminderIgnoredRule } from "./reminderIgnored";
import { reminderApproachingRule } from "./reminderApproaching";
import { overdueClusterRule } from "./overdueCluster";
import { recurringMissedRule } from "./recurringMissed";

export {
  paymentDueSoonRule,
  paymentOverdueRule,
  reminderIgnoredRule,
  reminderApproachingRule,
  overdueClusterRule,
  recurringMissedRule,
};

/** The full set of enabled V8 proactive rules, run in this fixed order. */
export const PROACTIVE_RULES: ProactiveRule[] = [
  paymentOverdueRule,
  paymentDueSoonRule,
  overdueClusterRule,
  reminderIgnoredRule,
  reminderApproachingRule,
  recurringMissedRule,
];
