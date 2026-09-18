// V7 Natural Language Assistant — strict intent allowlist.
//
// This is the ONLY set of operations the assistant can ever execute. Every
// field is strongly typed (no `any`/free-form object escape hatches) so no
// natural-language input can smuggle an arbitrary operation through this
// layer. See lib/assistant/executeIntent.ts for the exhaustive switch that
// enforces this at runtime as well as compile time.

import type { Priority, ReminderTypeKey } from "@/types/reminder";

export interface ParsedDateTime {
  /** ISO date (yyyy-mm-dd). */
  date: string;
  /** HH:mm, or null if only a date was specified (existing default_reminder_time applies downstream). */
  time: string | null;
}

export interface RecurrenceSpec {
  frequency: "daily" | "weekly" | "monthly";
  interval: number;
  by_weekday?: number[] | null;
}

export interface CreateReminderIntent {
  type: "CREATE_REMINDER";
  title: string;
  when: ParsedDateTime;
  reminderTypes: ReminderTypeKey[];
  priority?: Priority;
}

export interface CreateRecurringReminderIntent {
  type: "CREATE_RECURRING_REMINDER";
  title: string;
  when: ParsedDateTime;
  reminderTypes: ReminderTypeKey[];
  recurrence: RecurrenceSpec;
  priority?: Priority;
}

/** A reference to an existing reminder/payment, as extracted from text (not yet resolved to an id). */
export interface EntityReference {
  /** Raw text fragment naming the entity, e.g. "dentist call", "the Visa card". */
  text: string;
  /** Optional date hint to disambiguate ("the one tomorrow"). */
  dateHint?: string;
  /** True when the reference is a pronoun ("it", "that") that must resolve via conversation context. */
  isPronoun: boolean;
}

export interface UpdateReminderIntent {
  type: "UPDATE_REMINDER";
  reference: EntityReference;
  newWhen: ParsedDateTime;
}

export interface CompleteReminderIntent {
  type: "COMPLETE_REMINDER";
  reference: EntityReference;
}

export interface SnoozeReminderIntent {
  type: "SNOOZE_REMINDER";
  reference: EntityReference;
  minutes: number;
}

/** "Remind me again about X" — re-notify without changing the schedule. */
export interface RemindAgainIntent {
  type: "REMIND_AGAIN";
  reference: EntityReference;
}

export interface QueryTodayIntent {
  type: "QUERY_TODAY";
}

export interface QueryUpcomingIntent {
  type: "QUERY_UPCOMING";
}

export interface QueryOverdueIntent {
  type: "QUERY_OVERDUE";
}

export interface QueryPaymentsIntent {
  type: "QUERY_PAYMENTS";
}

export interface MarkPaymentPaidIntent {
  type: "MARK_PAYMENT_PAID";
  reference: EntityReference;
}

/** The full allowlist. Nothing outside this union may reach execution. */
export type AssistantIntent =
  | CreateReminderIntent
  | CreateRecurringReminderIntent
  | UpdateReminderIntent
  | CompleteReminderIntent
  | SnoozeReminderIntent
  | RemindAgainIntent
  | QueryTodayIntent
  | QueryUpcomingIntent
  | QueryOverdueIntent
  | QueryPaymentsIntent
  | MarkPaymentPaidIntent;

export type AssistantIntentType = AssistantIntent["type"];

export interface NeedsClarificationResult {
  kind: "NEEDS_CLARIFICATION";
  question: string;
  /** What the parser/validator was trying to build, for debugging/tests only — never executed. */
  partialType?: AssistantIntentType;
}

export interface UnsupportedResult {
  kind: "UNSUPPORTED";
  reason: string;
}

export interface IntentResult {
  kind: "INTENT";
  intent: AssistantIntent;
}

export type ParseResult = IntentResult | NeedsClarificationResult | UnsupportedResult;
