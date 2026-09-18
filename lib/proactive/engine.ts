import { db } from "@/lib/db";
import { getNotificationProvider } from "@/lib/notifications/providers";
import { PROACTIVE_RULES } from "./rules";
import { isWithinQuietHours } from "./quietHours";
import type { ProactiveEvent, ProactiveRuleContext } from "./types";
import type { NotificationChannel, PaymentAccount, PaymentCycle, Reminder } from "@/types/reminder";

export interface ProactiveRunResult {
  ruleId: string;
  subjectType: string;
  subjectId: string;
  priority: string;
  outcome: "sent" | "failed" | "not_configured" | "invalid_number" | "suppressed_quiet_hours" | "suppressed_cooldown";
  channel?: NotificationChannel;
}

/**
 * Impure orchestrator for V8 Proactive Intelligence — the only piece of V8
 * allowed to touch the DB/providers. Rules themselves (lib/proactive/rules)
 * stay pure. Called from the SAME cron invocation as the existing
 * due-reminder scan (see app/api/cron/process-due-reminders/route.ts) — no
 * second scheduler.
 *
 * Anti-spam guarantees:
 *  - respects user_preferences.proactive_intelligence_enabled (off by
 *    default is NOT the default — see schema default — but always
 *    checked here).
 *  - respects quiet hours (user_preferences.quiet_hours_start/end).
 *  - a rule+subject pair that already fired within the rule's
 *    cooldownMinutes is skipped (proactive_notifications is the source of
 *    truth for this, so it survives across cron invocations/restarts).
 *  - never sends more than one alert per rule+subject per evaluation call.
 */
export async function runProactiveIntelligence(now: Date = new Date()): Promise<ProactiveRunResult[]> {
  const userId = await db.getCurrentUserId();
  const preferences = await db.getPreferences(userId);
  const results: ProactiveRunResult[] = [];

  if (!preferences.proactive_intelligence_enabled) {
    return results;
  }

  const reminders: Reminder[] = await db.listReminders(userId);
  const occurrences = await db.listUpcomingOccurrences(userId);

  const accounts: PaymentAccount[] = (await db.listPaymentAccounts(userId)).filter((a) => a.active);
  const paymentCycles: Array<{ account: PaymentAccount; cycle: PaymentCycle }> = [];
  for (const account of accounts) {
    for (const cycle of await db.listPaymentCycles(account.id)) {
      if (cycle.status === "paid") continue;
      paymentCycles.push({ account, cycle });
    }
  }

  const context: ProactiveRuleContext = { now, reminders, occurrences, paymentCycles };
  const quiet = isWithinQuietHours(now, preferences.quiet_hours_start, preferences.quiet_hours_end);
  const provider = getNotificationProvider();

  for (const rule of PROACTIVE_RULES) {
    let events: ProactiveEvent[];
    try {
      events = rule.evaluate(context);
    } catch {
      // A misbehaving rule must never take down the cron run or the rest
      // of proactive intelligence — skip it for this pass.
      continue;
    }

    for (const event of events) {
      const last = await db.getLastProactiveNotification(userId, event.ruleId, event.subjectType, event.subjectId);
      const cooldownActive =
        !!last && now.getTime() - new Date(last.fired_at).getTime() < rule.cooldownMinutes * 60_000;

      if (cooldownActive) {
        results.push({
          ruleId: event.ruleId,
          subjectType: event.subjectType,
          subjectId: event.subjectId,
          priority: event.priority,
          outcome: "suppressed_cooldown",
        });
        continue;
      }

      if (quiet) {
        // Logged (not silently dropped) so it counts toward the cooldown —
        // otherwise the same situation would fire the instant quiet hours
        // end, then again on the very next tick.
        await db.logProactiveNotification({
          userId,
          ruleId: event.ruleId,
          subjectType: event.subjectType,
          subjectId: event.subjectId,
          priority: event.priority,
          channel: null,
          message: event.message,
          outcome: "suppressed_quiet_hours",
        });
        results.push({
          ruleId: event.ruleId,
          subjectType: event.subjectType,
          subjectId: event.subjectId,
          priority: event.priority,
          outcome: "suppressed_quiet_hours",
        });
        continue;
      }

      // Use the SPECIFIC reminder's own configured channels when this event
      // is about one (never force push on everything); otherwise fall back
      // to the user's global preferred channels.
      const linkedReminder = event.reminderId ? await db.getReminder(event.reminderId) : null;
      const requestedChannels: NotificationChannel[] = linkedReminder?.channels.length
        ? linkedReminder.channels
        : preferences.preferred_channels.length
          ? preferences.preferred_channels
          : ["push"];
      const channel = requestedChannels[0];

      const outcome = await dispatch(provider, channel, userId, preferences.phone_number, event.message);

      await db.logProactiveNotification({
        userId,
        ruleId: event.ruleId,
        subjectType: event.subjectType,
        subjectId: event.subjectId,
        priority: event.priority,
        channel,
        message: event.message,
        outcome: outcome.outcome,
      });

      // Keep the existing reminder-facing history consistent when this
      // event is tied to a specific reminder — reuses addHistory, doesn't
      // invent a second history mechanism.
      if (event.reminderId) {
        await db.addHistory(
          event.reminderId,
          "notified",
          `proactive (${event.ruleId}): ${channel} — ${outcome.outcome}`
        );
      }

      results.push({
        ruleId: event.ruleId,
        subjectType: event.subjectType,
        subjectId: event.subjectId,
        priority: event.priority,
        outcome: outcome.outcome,
        channel,
      });
    }
  }

  return results;
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
      return provider.sendPush(userId, JSON.stringify({ title: "NOVA", body: message }));
    case "sms":
    // Proactive alerts never place an actual PHONE CALL — that stays
    // reserved for the existing escalation engine's own decision; a
    // reminder configured for "call" gets sms here instead, still going to
    // the person's own configured number (never a reminder's contact info).
    case "call":
      return provider.sendSms(phoneNumber ?? "", message);
    case "email":
    default:
      return provider.sendEmail(userId, "NOVA proactive alert", message);
  }
}
