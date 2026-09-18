/**
 * V11 Automation Engine — shared config shapes for trigger_config /
 * condition_config / action_config JSON blobs stored on `automations`.
 * Kept intentionally small: this pass ships a fixed set of pre-defined,
 * safely-parameterized automation templates (see lib/automation/templates.ts),
 * not an arbitrary trigger/condition/action composer.
 */

export interface ReminderCompletedTriggerConfig {
  /** Optional: only fire for reminders whose title contains this text (case-insensitive). */
  titleContains?: string;
}

export interface CronTriggerConfig {
  /** HH:mm, local server time — informational only; cron_daily/cron_weekly
   * both actually run once per invocation of the existing cron route, and
   * "once per period" is enforced via automations.last_run_at. */
  atTime?: string;
}

export interface CreateReminderActionConfig {
  title: string;
  daysFromNow?: number; // default 0 (today)
  time?: string; // HH:mm
  priority?: "low" | "medium" | "high" | "urgent";
  notes?: string;
}

export interface SendNotificationActionConfig {
  message: string;
  channel?: "push" | "sms" | "email" | "call";
}
