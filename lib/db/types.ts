import type {
  Reminder,
  ReminderInput,
  ReminderOccurrence,
  ReminderHistoryEntry,
  UserPreferences,
  UserPreferencesUpdate,
  ReminderTypeKey,
  PersonalContextEntry,
  MemorySource,
  NotificationChannel,
  NotificationOutcome,
  PushSubscriptionRecord,
  PaymentAccount,
  PaymentAccountInput,
  PaymentAccountUpdate,
  PaymentCycle,
  ProactiveNotificationRecord,
  ProactiveNotificationOutcome,
  IntegrationAccountRecord,
  IntegrationProvider,
  IntegrationStatus,
  AutomationRecord,
  AutomationInput,
  AutomationRunRecord,
  AutomationRunOutcome,
  AnalyticsRecommendationRecord,
  AnalyticsRecommendationStatus,
} from "@/types/reminder";

/**
 * DataLayer is the single contract the rest of the app depends on.
 * Two implementations exist:
 *  - lib/db/local.ts    -> better-sqlite3, works offline, seeded with demo data
 *  - lib/db/supabase.ts -> real Supabase/Postgres, used when env vars are set
 *
 * lib/db/index.ts picks one based on NOVA_DATA_SOURCE so the rest of the
 * codebase (business logic + UI) never imports a concrete implementation.
 *
 * NOTE (Phase 1 production hardening): every method returns a Promise.
 * The original SQLite-only design had these typed as synchronous return
 * values, which happened to work only because better-sqlite3 is a
 * synchronous driver. A real Postgres/Supabase client (the `pg` driver)
 * is fundamentally asynchronous, so the interface was widened to be
 * Promise-based throughout. lib/db/local.ts's methods are declared
 * `async` but still execute their SQLite calls synchronously inside the
 * function body (better-sqlite3 itself never changed) - only the return
 * type changed, wrapping the same values in a resolved Promise. Every
 * call site across the app was updated to `await` these calls.
 */
export interface DataLayer {
  getCurrentUserId(): Promise<string>;
  getPreferences(userId: string): Promise<UserPreferences>;
  updatePreferences(userId: string, update: UserPreferencesUpdate): Promise<UserPreferences>;

  listPersonalContext(userId: string, options?: { includeInactive?: boolean }): Promise<PersonalContextEntry[]>;
  addPersonalContext(
    userId: string,
    entry: { category?: string; label: string; value: string; source?: MemorySource }
  ): Promise<PersonalContextEntry>;
  updatePersonalContext(
    id: string,
    changes: { category?: string; label?: string; value?: string; active?: boolean }
  ): Promise<PersonalContextEntry | null>;
  deletePersonalContext(id: string): Promise<void>;

  logNotification(args: {
    reminderId: string;
    occurrenceId: string;
    channel: NotificationChannel | "in_app";
    message: string;
    outcome: NotificationOutcome;
    attemptNumber?: number;
    escalationLevel?: number;
    providerRef?: string | null;
  }): Promise<void>;
  listNotifications(reminderId: string): Promise<import("@/types/reminder").NotificationLogEntry[]>;

  listReminders(userId: string, filter?: ReminderFilter): Promise<Reminder[]>;
  getReminder(id: string): Promise<Reminder | null>;
  createReminder(userId: string, input: ReminderInput): Promise<Reminder>;
  updateReminderStatus(id: string, status: Reminder["status"]): Promise<void>;
  rescheduleReminder(id: string, date: string, time: string | null): Promise<void>;
  completeReminder(id: string): Promise<Reminder | null>;
  snoozeReminder(id: string, minutes: number): Promise<Reminder | null>;

  listOccurrences(reminderId: string): Promise<ReminderOccurrence[]>;
  listUpcomingOccurrences(userId: string): Promise<(ReminderOccurrence & { reminder: Reminder })[]>;
  addOccurrence(reminderId: string, scheduledFor: string): Promise<ReminderOccurrence>;
  markOccurrenceNotified(occurrenceId: string, escalated: boolean): Promise<void>;
  updateOccurrenceFollowUp(
    occurrenceId: string,
    fields: Partial<{
      follow_up_state: import("@/types/reminder").FollowUpState;
      notification_attempt_count: number;
      escalation_level: number;
      last_notified_at: string | null;
      next_follow_up_at: string | null;
    }>
  ): Promise<void>;
  stopOccurrenceFollowUp(reminderId: string, state: "completed" | "cancelled"): Promise<void>;

  listHistory(reminderId: string): Promise<ReminderHistoryEntry[]>;
  addHistory(
    reminderId: string,
    action: ReminderHistoryEntry["action"],
    detail?: string,
    occurrenceId?: string
  ): Promise<void>;

  upsertPushSubscription(
    userId: string,
    sub: { endpoint: string; p256dh: string; auth: string }
  ): Promise<PushSubscriptionRecord>;
  listActivePushSubscriptions(userId: string): Promise<PushSubscriptionRecord[]>;
  deactivatePushSubscription(endpoint: string): Promise<void>;
  recordPushFailure(endpoint: string): Promise<void>;

  // V5: Payment Intelligence
  listPaymentAccounts(userId: string): Promise<PaymentAccount[]>;
  getPaymentAccount(id: string): Promise<PaymentAccount | null>;
  createPaymentAccount(userId: string, input: PaymentAccountInput): Promise<PaymentAccount>;
  updatePaymentAccount(id: string, update: PaymentAccountUpdate): Promise<PaymentAccount | null>;
  setPaymentAccountActive(id: string, active: boolean): Promise<PaymentAccount | null>;

  listPaymentCycles(accountId: string): Promise<PaymentCycle[]>;
  getPaymentCycle(id: string): Promise<PaymentCycle | null>;
  getPaymentCycleByPeriod(accountId: string, cyclePeriod: string): Promise<PaymentCycle | null>;
  createPaymentCycle(
    accountId: string,
    fields: { cyclePeriod: string; statementDate: string; dueDate: string; amount: number; minimumAmount: number | null }
  ): Promise<PaymentCycle>;
  linkPaymentCycleReminder(cycleId: string, reminderId: string): Promise<void>;
  updatePaymentCycleStatus(cycleId: string, status: PaymentCycle["status"]): Promise<void>;
  markPaymentCyclePaid(cycleId: string): Promise<PaymentCycle | null>;

  // V8: Proactive Intelligence
  /** Most recent firing for this exact rule+subject, if any (used for cooldown checks). */
  getLastProactiveNotification(
    userId: string,
    ruleId: string,
    subjectType: string,
    subjectId: string
  ): Promise<ProactiveNotificationRecord | null>;
  logProactiveNotification(args: {
    userId: string;
    ruleId: string;
    subjectType: "reminder" | "payment_cycle" | "cluster";
    subjectId: string;
    priority: "low" | "medium" | "high" | "urgent";
    channel: NotificationChannel | null;
    message: string;
    outcome: ProactiveNotificationOutcome;
  }): Promise<ProactiveNotificationRecord>;
  listProactiveNotifications(userId: string, limit?: number): Promise<ProactiveNotificationRecord[]>;

  // V11: anti-chaining check for the reminder_completed trigger.
  wasCreatedByAutomation(reminderId: string): Promise<boolean>;

  // V11: Integrations
  getIntegrationAccount(userId: string, provider: IntegrationProvider): Promise<IntegrationAccountRecord | null>;
  upsertIntegrationAccount(
    userId: string,
    provider: IntegrationProvider,
    fields: Partial<{
      status: IntegrationStatus;
      access_token: string | null;
      refresh_token: string | null;
      expires_at: string | null;
      connected_at: string | null;
      last_sync_at: string | null;
      last_error: string | null;
    }>
  ): Promise<IntegrationAccountRecord>;

  // V11: Automation
  listAutomations(userId: string): Promise<AutomationRecord[]>;
  getAutomation(id: string): Promise<AutomationRecord | null>;
  createAutomation(userId: string, input: AutomationInput): Promise<AutomationRecord>;
  updateAutomation(
    id: string,
    changes: Partial<Pick<AutomationRecord, "name" | "enabled" | "trigger_config" | "condition_config" | "action_config">>
  ): Promise<AutomationRecord | null>;
  deleteAutomation(id: string): Promise<void>;
  touchAutomationLastRun(id: string, at: string): Promise<void>;
  logAutomationRun(args: {
    automationId: string;
    triggerContext?: string | null;
    outcome: AutomationRunOutcome;
    detail?: string | null;
  }): Promise<AutomationRunRecord>;
  listAutomationRuns(automationId: string, limit?: number): Promise<AutomationRunRecord[]>;

  // V12: Analytics — bounded read of raw data for pure metric computation,
  // plus recommendation apply/dismiss state (see lib/analytics/*).
  getAnalyticsSnapshot(userId: string, sinceISO: string): Promise<AnalyticsSnapshot>;
  listRecommendationStates(userId: string): Promise<AnalyticsRecommendationRecord[]>;
  /** Inserts a pending row only if this id doesn't already exist (never overwrites applied/dismissed). */
  ensureRecommendation(
    userId: string,
    id: string,
    fields: { type: string; subjectType: string; subjectId: string; payload: string }
  ): Promise<void>;
  setRecommendationStatus(id: string, status: AnalyticsRecommendationStatus): Promise<AnalyticsRecommendationRecord | null>;
}

export interface AnalyticsSnapshot {
  reminders: Reminder[];
  occurrences: ReminderOccurrence[];
  notifications: import("@/types/reminder").NotificationLogEntry[];
  history: ReminderHistoryEntry[];
  paymentCycles: PaymentCycle[];
  automationRuns: (AutomationRunRecord & { trigger_type: string; automation_name: string })[];
  proactiveNotifications: ProactiveNotificationRecord[];
}

export interface ReminderFilter {
  types?: ReminderTypeKey[];
  status?: Reminder["status"][];
  search?: string;
}
