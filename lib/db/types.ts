import type {
  Reminder,
  ReminderInput,
  ReminderOccurrence,
  ReminderHistoryEntry,
  UserPreferences,
  UserPreferencesUpdate,
  ReminderTypeKey,
  PersonalContextEntry,
  NotificationChannel,
  NotificationOutcome,
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

  listPersonalContext(userId: string): PersonalContextEntry[];
  addPersonalContext(
    userId: string,
    entry: { category?: string; label: string; value: string }
  ): PersonalContextEntry;
  updatePersonalContext(
    id: string,
    changes: { category?: string; label?: string; value?: string }
  ): PersonalContextEntry | null;
  deletePersonalContext(id: string): void;

  logNotification(args: {
    reminderId: string;
    occurrenceId: string;
    channel: NotificationChannel | "in_app";
    message: string;
    outcome: NotificationOutcome;
  }): void;

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

  listHistory(reminderId: string): ReminderHistoryEntry[];
  addHistory(reminderId: string, action: ReminderHistoryEntry["action"], detail?: string): void;
}

export interface ReminderFilter {
  types?: ReminderTypeKey[];
  status?: Reminder["status"][];
  search?: string;
}
