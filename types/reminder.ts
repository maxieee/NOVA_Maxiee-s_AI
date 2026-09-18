// Core domain types for NOVA. These mirror the relational schema in
// database/migrations and are shared by the DB layer, business logic and UI.

export type ReminderTypeKey =
  | "task"
  | "payment"
  | "call"
  | "meeting"
  | "follow_up"
  | "important_date"
  | "general"
  | "recurring";

export interface ReminderType {
  id: string;
  key: ReminderTypeKey;
  label: string;
  icon: string;
  color: string;
}

export type Priority = "low" | "medium" | "high" | "urgent";

export type NotificationChannel = "push" | "sms" | "email" | "call";

export type ReminderIntensity = "gentle" | "normal" | "persistent" | "critical";

export type NotificationOutcome = "sent" | "failed" | "not_configured" | "invalid_number";

export type NotificationBehavior = "notify_once" | "repeat_until_done" | "silent";

export interface PersonalContextEntry {
  id: string;
  user_id: string;
  category: string;
  label: string;
  value: string;
  created_at: string;
  updated_at: string;
}

export type ReminderStatus =
  | "created"
  | "scheduled"
  | "notified"
  | "snoozed"
  | "completed"
  | "cancelled";

export type RecurrenceFrequency =
  | "daily"
  | "weekly"
  | "monthly"
  | "yearly"
  | "custom_days";

export interface RecurrenceRule {
  id: string;
  reminder_id: string;
  frequency: RecurrenceFrequency;
  interval: number; // every N units
  by_day_of_month?: number | null;
  by_month?: number | null;
  by_weekday?: number[] | null; // 0=Sun..6=Sat
  ends_at?: string | null; // ISO date, null = never
  occurrences_limit?: number | null;
}

export interface PaymentDetails {
  id: string;
  reminder_id: string;
  amount: number;
  currency: string;
  payee: string | null;
  account_last4: string | null;
  category:
    | "credit_card"
    | "bill"
    | "emi"
    | "subscription"
    | "loan"
    | "other";
  billing_date: string | null; // ISO date
  due_date: string; // ISO date
  autopay: boolean;
  paid_status: "unpaid" | "paid" | "partially_paid" | "overdue";
}

export interface CallDetails {
  contact_name: string;
  phone_number?: string;
}

export interface MeetingDetails {
  location?: string;
  meeting_link?: string;
  attendees?: string[];
}

export interface FollowUpDetails {
  related_to?: string;
  last_contacted_at?: string | null;
}

/** Occurrence-level follow-up lifecycle state (see lib/notifications/followUpConfig.ts). */
export type FollowUpState =
  | "pending"
  | "due"
  | "notified"
  | "waiting"
  | "follow_up_sent"
  | "escalated"
  | "completed"
  | "cancelled";

export interface ReminderOccurrence {
  id: string;
  reminder_id: string;
  scheduled_for: string; // ISO datetime
  fired_at?: string | null;
  status: "pending" | "fired" | "acknowledged" | "missed" | "cancelled";
  repeat_count: number;
  escalated: boolean;
  follow_up_state: FollowUpState;
  notification_attempt_count: number;
  escalation_level: number;
  last_notified_at?: string | null;
  next_follow_up_at?: string | null;
}

export interface NotificationLogEntry {
  id: string;
  reminder_id: string;
  occurrence_id: string;
  sent_at: string;
  channel: "in_app" | "push" | "email" | "sms" | "call";
  outcome?: NotificationOutcome;
  attempt_number?: number;
  escalation_level?: number;
  message: string;
  provider_ref?: string | null;
}

export interface ReminderHistoryEntry {
  id: string;
  reminder_id: string;
  action:
    | "created"
    | "updated"
    | "notified"
    | "snoozed"
    | "completed"
    | "cancelled"
    | "escalated";
  detail?: string | null;
  created_at: string;
  occurrence_id?: string | null;
}

export interface Reminder {
  id: string;
  user_id: string;
  title: string;
  description: string | null;
  date: string; // ISO date (yyyy-mm-dd)
  time: string | null; // HH:mm
  priority: Priority;
  notes: string | null;
  status: ReminderStatus;
  created_at: string;
  updated_at: string;
  completed_at: string | null;

  // Denormalized/joined for UI convenience (populated by lib/db)
  types: ReminderTypeKey[];
  payment?: PaymentDetails | null;
  call?: CallDetails | null;
  meeting?: MeetingDetails | null;
  follow_up?: FollowUpDetails | null;
  recurrence?: RecurrenceRule | null;
  next_occurrence?: string | null; // ISO datetime of next scheduled fire
  channels: NotificationChannel[];
  intensity: ReminderIntensity;
}

export interface ReminderInput {
  title: string;
  description?: string;
  date: string;
  time?: string;
  priority: Priority;
  notes?: string;
  types: ReminderTypeKey[];
  payment?: Partial<PaymentDetails>;
  call?: CallDetails;
  meeting?: MeetingDetails;
  follow_up?: FollowUpDetails;
  recurrence?: Partial<RecurrenceRule>;
  channels?: NotificationChannel[];
  intensity?: ReminderIntensity;
}

export interface UserPreferences {
  user_id: string;
  display_name: string;
  reminder_lead_days: number[]; // e.g. [7,3,1] for payments
  repeat_interval_minutes: number; // e.g. 120 = every 2 hours
  escalation_enabled: boolean;
  theme: "dark" | "light" | "system";

  // Personalization (all user-entered, persisted via the DB, never hardcoded)
  preferred_name: string | null;
  nova_should_call_user: string | null;
  default_reminder_time: string; // HH:mm
  default_snooze_minutes: number;
  default_notification_behavior: NotificationBehavior;
  timezone: string;
  quiet_hours_start: string | null; // HH:mm
  quiet_hours_end: string | null; // HH:mm
  default_intensity: ReminderIntensity;
  repeat_ignored_reminders: boolean;
  escalate_urgent_reminders: boolean;
  preferred_channels: NotificationChannel[];

  // Follow-up engine tuning (defaults mirror lib/notifications/followUpConfig.ts).
  max_follow_up_attempts: number;
  escalation_threshold_repeats: number;
  /** The number NOVA calls/texts on escalation — the person's own phone, not any reminder's call_details contact. */
  phone_number: string | null;
}

export type UserPreferencesUpdate = Partial<
  Omit<UserPreferences, "user_id" | "display_name">
>;

export type Urgency = "overdue" | "urgent" | "due_today" | "upcoming" | "completed";

export interface PushSubscriptionRecord {
  id: string;
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  active: boolean;
  failure_count: number;
  last_failure_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface DashboardCounts {
  urgent: number;
  dueToday: number;
  overdue: number;
  completed: number;
}

// --- V5: Payment Intelligence ---------------------------------------------
// A payment_account is the recurring OBLIGATION (a card, an EMI, a bill, a
// subscription). Each billing period it produces a payment_cycle, and each
// cycle drives one ordinary NOVA reminder (type "payment", with its
// existing payment_details row) so the existing reminder/follow-up/
// escalation engine handles it unmodified — see lib/scheduling/paymentCycles.ts.

export type PaymentAccountType = "CREDIT_CARD" | "EMI" | "BILL" | "SUBSCRIPTION" | "OTHER";

export type DueDateRule = "fixed_day" | "days_after_statement";

export interface PaymentAccount {
  id: string;
  user_id: string;
  name: string;
  payment_type: PaymentAccountType;
  issuer: string | null;
  /** Masked identifier only, e.g. "Visa •••• 1234" — never a raw account/card number. */
  masked_identifier: string | null;
  active: boolean;
  statement_date_rule: number; // day-of-month the statement is generated, 1-31 (clamped to month length)
  due_date_rule: DueDateRule;
  fixed_due_day: number | null; // used when due_date_rule = "fixed_day"
  due_days_after_statement: number | null; // used when due_date_rule = "days_after_statement"
  default_amount: number;
  minimum_amount: number | null;
  autopay_enabled: boolean;
  reminder_enabled: boolean;
  escalation_enabled: boolean;
  created_at: string;
  updated_at: string;
}

export type PaymentAccountInput = Omit<PaymentAccount, "id" | "user_id" | "created_at" | "updated_at">;
export type PaymentAccountUpdate = Partial<PaymentAccountInput>;

export type PaymentCycleStatus = "upcoming" | "due_soon" | "due_today" | "overdue" | "paid";

export interface PaymentCycle {
  id: string;
  payment_account_id: string;
  cycle_period: string; // e.g. "2026-01"
  statement_date: string; // ISO date
  due_date: string; // ISO date
  amount: number;
  minimum_amount: number | null;
  status: PaymentCycleStatus;
  paid_at: string | null;
  reminder_id: string | null;
  created_at: string;
  updated_at: string;
}
