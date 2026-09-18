import type { PaymentAccount, PaymentCycle, Reminder, ReminderOccurrence } from "@/types/reminder";

/**
 * V8 Proactive Intelligence — shared types.
 *
 * A "rule" is a pure function (no DB/IO) that inspects already-fetched data
 * and decides whether NOVA should proactively say something the person
 * didn't explicitly ask for right now (as opposed to the existing
 * reminder/payment follow-up engines, which only ever notify about a thing
 * the person scheduled). Mirrors the pure-function style of
 * lib/scheduling/urgency.ts and lib/scheduling/paymentCycles.ts.
 */

export type ProactivePriority = "low" | "medium" | "high" | "urgent";

export type ProactiveSubjectType = "reminder" | "payment_cycle" | "cluster";

/** A candidate proactive alert a rule wants NOVA to (maybe) send. */
export interface ProactiveEvent {
  ruleId: string;
  priority: ProactivePriority;
  subjectType: ProactiveSubjectType;
  /** reminder id, payment_cycle id, or a stable synthetic key for a cluster event. */
  subjectId: string;
  /** Human-readable message body for the notification. */
  message: string;
  /** The reminder this event is about, if any — used by the engine to pick
   * that reminder's own configured channels rather than forcing a channel. */
  reminderId?: string;
}

/** Data a rule needs, already fetched by the impure engine — rules never query the DB themselves. */
export interface ProactiveRuleContext {
  now: Date;
  reminders: Reminder[];
  /** Upcoming (pending/fired) occurrences joined with their reminder. */
  occurrences: (ReminderOccurrence & { reminder: Reminder })[];
  paymentCycles: Array<{ account: PaymentAccount; cycle: PaymentCycle }>;
}

export interface ProactiveRule {
  id: string;
  description: string;
  priority: ProactivePriority;
  /** Minimum minutes between two alerts for the same rule+subject. */
  cooldownMinutes: number;
  evaluate(ctx: ProactiveRuleContext): ProactiveEvent[];
}
