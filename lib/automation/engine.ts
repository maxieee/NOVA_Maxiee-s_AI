import { db } from "@/lib/db";
import { getNotificationProvider } from "@/lib/notifications/providers";
import { toISODate } from "@/lib/utils/date";
import type {
  AutomationRecord,
  Reminder,
  PaymentAccount,
  PaymentCycle,
  NotificationChannel,
} from "@/types/reminder";
import type {
  ReminderCompletedTriggerConfig,
  CreateReminderActionConfig,
  SendNotificationActionConfig,
} from "./types";

/**
 * V11 Automation Engine — impure orchestrator, same architectural role as
 * lib/proactive/engine.ts: the only place automation logic touches the
 * DB/providers. Actions call ONLY existing reminder/notification creation
 * paths (db.createReminder / the existing notification provider
 * abstraction) — there is no parallel action executor.
 *
 * Anti-chaining (hard rule for this pass, not a hop-count heuristic): any
 * reminder created by an automation action is flagged
 * created_by_automation = 1. The reminder_completed trigger explicitly
 * refuses to fire for such reminders (see onReminderCompleted below), so
 * an automation's own output can never itself satisfy another
 * automation's trigger — no automation can trigger itself or another
 * automation, directly or indirectly, through this pass's trigger set.
 *
 * Idempotency:
 *  - event-triggered (reminder_completed): each call passes the specific
 *    reminderId that was just completed; automation_runs records exactly
 *    one run per (automation, reminderId) trigger_context, and a repeat
 *    call with the SAME reminderId is detected via a dedup lookup before
 *    the action executes, so replaying the same completion event never
 *    double-fires.
 *  - periodic (cron_daily/cron_weekly): automations.last_run_at tracks the
 *    last period this automation successfully ran; a second evaluation
 *    within the same period is skipped and logged as
 *    "skipped_cooldown", mirroring V8's cooldown pattern.
 */

export interface AutomationFireResult {
  automationId: string;
  outcome: "success" | "failed" | "skipped_condition" | "skipped_cooldown";
  detail?: string;
}

function periodKey(triggerType: "cron_daily" | "cron_weekly", now: Date): string {
  if (triggerType === "cron_daily") return toISODate(now);
  // ISO week key: year + Monday-of-week date, stable across the whole week.
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() - day + 1);
  return `week-${toISODate(d)}`;
}

async function runAction(automation: AutomationRecord, userId: string): Promise<AutomationFireResult> {
  try {
    if (automation.action_type === "create_reminder") {
      const cfg = JSON.parse(automation.action_config) as CreateReminderActionConfig;
      const date = new Date();
      date.setDate(date.getDate() + (cfg.daysFromNow ?? 0));
      const reminder = db.createReminder(userId, {
        title: cfg.title,
        date: toISODate(date),
        time: cfg.time,
        priority: cfg.priority ?? "medium",
        notes: cfg.notes,
        types: ["general"],
        createdByAutomation: true,
      });
      return { automationId: automation.id, outcome: "success", detail: `created reminder ${reminder.id}` };
    }

    if (automation.action_type === "send_notification") {
      const cfg = JSON.parse(automation.action_config) as SendNotificationActionConfig;
      const preferences = db.getPreferences(userId);
      const provider = getNotificationProvider();
      const channel: NotificationChannel = cfg.channel ?? preferences.preferred_channels[0] ?? "push";
      const outcome = await dispatch(provider, channel, userId, preferences.phone_number, cfg.message);
      return {
        automationId: automation.id,
        outcome: outcome.outcome === "sent" ? "success" : "failed",
        detail: `${channel}: ${outcome.outcome}${outcome.detail ? ` — ${outcome.detail}` : ""}`,
      };
    }

    return { automationId: automation.id, outcome: "failed", detail: "Unknown action_type." };
  } catch (err) {
    return {
      automationId: automation.id,
      outcome: "failed",
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

async function dispatch(
  provider: ReturnType<typeof getNotificationProvider>,
  channel: NotificationChannel,
  userId: string,
  phoneNumber: string | null,
  message: string
) {
  switch (channel) {
    case "push":
      return provider.sendPush(userId, JSON.stringify({ title: "NOVA automation", body: message }));
    case "sms":
      return provider.sendSms(phoneNumber ?? "", message);
    case "call":
      return provider.placeCall(phoneNumber ?? "", message);
    case "email":
    default:
      return provider.sendEmail(userId, "NOVA automation", message);
  }
}

/**
 * Fired synchronously right after a real db.completeReminder() call
 * succeeds — see app/api/reminders/[id]/done/route.ts and
 * lib/assistant/executeIntent.ts's COMPLETE_REMINDER case, the two exact
 * call sites where "a reminder was completed" already happens in the
 * existing codebase. Never polls for "was something completed recently".
 */
export async function onReminderCompleted(
  completedReminder: Reminder,
  now: Date = new Date()
): Promise<AutomationFireResult[]> {
  const results: AutomationFireResult[] = [];

  // Anti-chaining: an automation-created reminder being completed must
  // never itself trigger a reminder_completed automation.
  if (db.wasCreatedByAutomation(completedReminder.id)) {
    return results;
  }

  const automations = db
    .listAutomations(completedReminder.user_id)
    .filter((a) => a.enabled && a.trigger_type === "reminder_completed");

  for (const automation of automations) {
    const triggerContext = completedReminder.id;

    // Idempotency: skip if this exact automation already ran for this
    // exact reminder (protects against the same completion event being
    // replayed, e.g. a duplicate request).
    const existingRuns = db.listAutomationRuns(automation.id, 200);
    const alreadyRan = existingRuns.some(
      (r) => r.trigger_context === triggerContext && r.outcome === "success"
    );
    if (alreadyRan) {
      db.logAutomationRun({
        automationId: automation.id,
        triggerContext,
        outcome: "skipped_cooldown",
        detail: "Already ran for this reminder completion.",
      });
      results.push({ automationId: automation.id, outcome: "skipped_cooldown" });
      continue;
    }

    const cfg = JSON.parse(automation.trigger_config || "{}") as ReminderCompletedTriggerConfig;
    if (cfg.titleContains && !completedReminder.title.toLowerCase().includes(cfg.titleContains.toLowerCase())) {
      db.logAutomationRun({
        automationId: automation.id,
        triggerContext,
        outcome: "skipped_condition",
        detail: `Title did not contain "${cfg.titleContains}".`,
      });
      results.push({ automationId: automation.id, outcome: "skipped_condition" });
      continue;
    }

    const result = await runAction(automation, completedReminder.user_id);
    db.logAutomationRun({
      automationId: automation.id,
      triggerContext,
      outcome: result.outcome,
      detail: result.detail,
    });
    if (result.outcome === "success") {
      db.touchAutomationLastRun(automation.id, now.toISOString());
    }
    results.push(result);
  }

  return results;
}

/**
 * Evaluated inside the SAME cron invocation as the existing due-reminder
 * scan and V8 proactive intelligence (see
 * app/api/cron/process-due-reminders/route.ts) — not a second scheduler.
 * cron_daily fires at most once per calendar day, cron_weekly at most once
 * per ISO week, tracked via automations.last_run_at (same cooldown
 * pattern as V8's proactive_notifications table).
 */
export async function runPeriodicAutomations(now: Date = new Date()): Promise<AutomationFireResult[]> {
  const userId = db.getCurrentUserId();
  const results: AutomationFireResult[] = [];
  const automations = db
    .listAutomations(userId)
    .filter((a) => a.enabled && (a.trigger_type === "cron_daily" || a.trigger_type === "cron_weekly"));

  for (const automation of automations) {
    const key = periodKey(automation.trigger_type as "cron_daily" | "cron_weekly", now);
    const alreadyRanThisPeriod =
      !!automation.last_run_at && periodKeyFromISO(automation.trigger_type as "cron_daily" | "cron_weekly", automation.last_run_at) === key;

    if (alreadyRanThisPeriod) {
      db.logAutomationRun({
        automationId: automation.id,
        triggerContext: key,
        outcome: "skipped_cooldown",
        detail: "Already ran this period.",
      });
      results.push({ automationId: automation.id, outcome: "skipped_cooldown" });
      continue;
    }

    const result = await runAction(automation, userId);
    db.logAutomationRun({
      automationId: automation.id,
      triggerContext: key,
      outcome: result.outcome,
      detail: result.detail,
    });
    if (result.outcome === "success") {
      db.touchAutomationLastRun(automation.id, now.toISOString());
    }
    results.push(result);
  }

  return results;
}

function periodKeyFromISO(triggerType: "cron_daily" | "cron_weekly", iso: string): string {
  return periodKey(triggerType, new Date(iso));
}

/**
 * payment_overdue trigger: evaluated in the same cron invocation, reading
 * real overdue payment cycles via the existing DataLayer (same source V8
 * uses). Fires at most once per (automation, cycle) pair, tracked through
 * automation_runs.trigger_context.
 */
export async function runPaymentOverdueAutomations(now: Date = new Date()): Promise<AutomationFireResult[]> {
  const userId = db.getCurrentUserId();
  const results: AutomationFireResult[] = [];
  const automations = db
    .listAutomations(userId)
    .filter((a) => a.enabled && a.trigger_type === "payment_overdue");
  if (automations.length === 0) return results;

  const accounts: PaymentAccount[] = db.listPaymentAccounts(userId).filter((a) => a.active);
  const overdueCycles: PaymentCycle[] = [];
  for (const account of accounts) {
    for (const cycle of db.listPaymentCycles(account.id)) {
      if (cycle.status === "overdue") overdueCycles.push(cycle);
    }
  }

  for (const automation of automations) {
    for (const cycle of overdueCycles) {
      const triggerContext = cycle.id;
      const existingRuns = db.listAutomationRuns(automation.id, 500);
      const alreadyRan = existingRuns.some(
        (r) => r.trigger_context === triggerContext && r.outcome === "success"
      );
      if (alreadyRan) {
        results.push({ automationId: automation.id, outcome: "skipped_cooldown" });
        continue;
      }
      const result = await runAction(automation, userId);
      db.logAutomationRun({
        automationId: automation.id,
        triggerContext,
        outcome: result.outcome,
        detail: result.detail,
      });
      if (result.outcome === "success") {
        db.touchAutomationLastRun(automation.id, now.toISOString());
      }
      results.push(result);
    }
  }

  return results;
}
