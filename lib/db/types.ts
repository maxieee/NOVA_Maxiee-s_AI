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
} from "@/types/reminder";

/**
 * DataLayer is the single contract the rest of the app depends on.
 * Two implementations exist:
 *  - lib/db/local.ts    -> better-sqlite3, works offline, seeded with demo data
 *  - lib/db/supabase.ts -> real Supabase/Postgres, used when env vars are set
 *
 * lib/db/index.ts picks one based on NOVA_DATA_SOURCE so the rest of the
 * codebase (business logic + UI) never imports a concrete implementation.
 */
export interface DataLayer {
  getCurrentUserId(): string;
  getPreferences(userId: string): UserPreferences;
  updatePreferences(userId: string, update: UserPreferencesUpdate): UserPreferences;

  listPersonalContext(userId: string, options?: { includeInactive?: boolean }): PersonalContextEntry[];
  addPersonalContext(
    userId: string,
    entry: { category?: string; label: string; value: string; source?: MemorySource }
  ): PersonalContextEntry;
  updatePersonalContext(
    id: string,
    changes: { category?: string; label?: string; value?: string; active?: boolean }
  ): PersonalContextEntry | null;
  deletePersonalContext(id: string): void;

  logNotification(args: {
    reminderId: string;
    occurrenceId: string;
    channel: NotificationChannel | "in_app";
    message: string;
    outcome: NotificationOutcome;
    attemptNumber?: number;
    escalationLevel?: number;
    providerRef?: string | null;
  }): void;
  listNotifications(reminderId: string): import("@/types/reminder").NotificationLogEntry[];

  listReminders(userId: string, filter?: ReminderFilter): Reminder[];
  getReminder(id: string): Reminder | null;
  createReminder(userId: string, input: ReminderInput): Reminder;
  updateReminderStatus(id: string, status: Reminder["status"]): void;
  rescheduleReminder(id: string, date: string, time: string | null): void;
  completeReminder(id: string): Reminder | null;
  snoozeReminder(id: string, minutes: number): Reminder | null;

  listOccurrences(reminderId: string): ReminderOccurrence[];
  listUpcomingOccurrences(userId: string): (ReminderOccurrence & { reminder: Reminder })[];
  addOccurrence(reminderId: string, scheduledFor: string): ReminderOccurrence;
  markOccurrenceNotified(occurrenceId: string, escalated: boolean): void;
  updateOccurrenceFollowUp(
    occurrenceId: string,
    fields: Partial<{
      follow_up_state: import("@/types/reminder").FollowUpState;
      notification_attempt_count: number;
      escalation_level: number;
      last_notified_at: string | null;
      next_follow_up_at: string | null;
    }>
  ): void;
  stopOccurrenceFollowUp(reminderId: string, state: "completed" | "cancelled"): void;

  listHistory(reminderId: string): ReminderHistoryEntry[];
  addHistory(
    reminderId: string,
    action: ReminderHistoryEntry["action"],
    detail?: string,
    occurrenceId?: string
  ): void;

  upsertPushSubscription(
    userId: string,
    sub: { endpoint: string; p256dh: string; auth: string }
  ): PushSubscriptionRecord;
  listActivePushSubscriptions(userId: string): PushSubscriptionRecord[];
  deactivatePushSubscription(endpoint: string): void;
  recordPushFailure(endpoint: string): void;

  // V5: Payment Intelligence
  listPaymentAccounts(userId: string): PaymentAccount[];
  getPaymentAccount(id: string): PaymentAccount | null;
  createPaymentAccount(userId: string, input: PaymentAccountInput): PaymentAccount;
  updatePaymentAccount(id: string, update: PaymentAccountUpdate): PaymentAccount | null;
  setPaymentAccountActive(id: string, active: boolean): PaymentAccount | null;

  listPaymentCycles(accountId: string): PaymentCycle[];
  getPaymentCycle(id: string): PaymentCycle | null;
  getPaymentCycleByPeriod(accountId: string, cyclePeriod: string): PaymentCycle | null;
  createPaymentCycle(
    accountId: string,
    fields: { cyclePeriod: string; statementDate: string; dueDate: string; amount: number; minimumAmount: number | null }
  ): PaymentCycle;
  linkPaymentCycleReminder(cycleId: string, reminderId: string): void;
  updatePaymentCycleStatus(cycleId: string, status: PaymentCycle["status"]): void;
  markPaymentCyclePaid(cycleId: string): PaymentCycle | null;

  // V8: Proactive Intelligence
  /** Most recent firing for this exact rule+subject, if any (used for cooldown checks). */
  getLastProactiveNotification(
    userId: string,
    ruleId: string,
    subjectType: string,
    subjectId: string
  ): ProactiveNotificationRecord | null;
  logProactiveNotification(args: {
    userId: string;
    ruleId: string;
    subjectType: "reminder" | "payment_cycle" | "cluster";
    subjectId: string;
    priority: "low" | "medium" | "high" | "urgent";
    channel: NotificationChannel | null;
    message: string;
    outcome: ProactiveNotificationOutcome;
  }): ProactiveNotificationRecord;
  listProactiveNotifications(userId: string, limit?: number): ProactiveNotificationRecord[];

  // V11: anti-chaining check for the reminder_completed trigger.
  wasCreatedByAutomation(reminderId: string): boolean;

  // V11: Integrations
  getIntegrationAccount(userId: string, provider: IntegrationProvider): IntegrationAccountRecord | null;
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
  ): IntegrationAccountRecord;

  // V11: Automation
  listAutomations(userId: string): AutomationRecord[];
  getAutomation(id: string): AutomationRecord | null;
  createAutomation(userId: string, input: AutomationInput): AutomationRecord;
  updateAutomation(
    id: string,
    changes: Partial<Pick<AutomationRecord, "name" | "enabled" | "trigger_config" | "condition_config" | "action_config">>
  ): AutomationRecord | null;
  deleteAutomation(id: string): void;
  touchAutomationLastRun(id: string, at: string): void;
  logAutomationRun(args: {
    automationId: string;
    triggerContext?: string | null;
    outcome: AutomationRunOutcome;
    detail?: string | null;
  }): AutomationRunRecord;
  listAutomationRuns(automationId: string, limit?: number): AutomationRunRecord[];
}

export interface ReminderFilter {
  types?: ReminderTypeKey[];
  status?: Reminder["status"][];
  search?: string;
}
