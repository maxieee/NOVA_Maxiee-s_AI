import { db } from "@/lib/db";
import { decideFollowUp } from "@/lib/notifications/escalation";
import { FOLLOW_UP_INTERVAL_MINUTES } from "@/lib/notifications/followUpConfig";
import { getNotificationProvider, isTwilioConfigured, isWebPushConfigured } from "@/lib/notifications/providers";
import { buildPushPayload } from "@/lib/notifications/payload";
import { buildNotificationMessage } from "@/lib/notifications/messages";
import { buildCallMessage } from "@/lib/notifications/callScript";
import type { FollowUpState, NotificationChannel, Reminder } from "@/types/reminder";

export interface DueScanResult {
  occurrenceId: string;
  reminderId: string;
  action: "sent" | "waiting" | "stopped" | "skipped";
  channel?: NotificationChannel;
  outcome?: string;
  reason?: string;
}

function configuredChannels(): NotificationChannel[] {
  const channels: NotificationChannel[] = [];
  if (isWebPushConfigured()) channels.push("push");
  if (isTwilioConfigured()) channels.push("sms", "call");
  return channels;
}

/**
 * Server-side "source of truth" scan: finds occurrences that are due and
 * still following up, runs the occurrence-level follow-up engine
 * (lib/notifications/escalation.ts#decideFollowUp) against them, and — only
 * when it says to send now — actually dispatches via the provider
 * abstraction (push/sms/call) and persists the new follow-up state. No
 * client timer is trusted; this is meant to be invoked by a real scheduler
 * (see POST /api/cron/process-due-reminders), and it is safe to invoke any
 * number of times: an occurrence whose `next_follow_up_at` hasn't passed
 * yet is always a no-op, so re-running this within the same window never
 * re-sends the same attempt.
 */
export async function scanAndProcessDueReminders(now: Date = new Date()): Promise<DueScanResult[]> {
  const userId = db.getCurrentUserId();
  const preferences = db.getPreferences(userId);
  const occurrences = db.listUpcomingOccurrences(userId);
  const available = configuredChannels();
  const provider = getNotificationProvider();
  const results: DueScanResult[] = [];

  for (const occ of occurrences) {
    const reminder: Reminder = occ.reminder;

    // A reminder can be completed/cancelled out-of-band (e.g. the done API
    // races a cron run) — never notify for those, regardless of occurrence
    // state.
    if (reminder.status === "completed" || reminder.status === "cancelled") {
      if (occ.follow_up_state !== "completed" && occ.follow_up_state !== "cancelled") {
        db.updateOccurrenceFollowUp(occ.id, {
          follow_up_state: reminder.status === "completed" ? "completed" : "cancelled",
          next_follow_up_at: null,
        });
      }
      results.push({ occurrenceId: occ.id, reminderId: reminder.id, action: "skipped", reason: reminder.status });
      continue;
    }

    const decision = decideFollowUp({
      now,
      followUpState: occ.follow_up_state as FollowUpState,
      intensity: reminder.intensity,
      requestedChannels: reminder.channels.length ? reminder.channels : ["push"],
      configuredChannels: available,
      scheduledFor: occ.scheduled_for,
      lastNotifiedAt: occ.last_notified_at ?? null,
      nextFollowUpAt: occ.next_follow_up_at ?? null,
      notificationAttemptCount: occ.notification_attempt_count,
      escalationLevel: occ.escalation_level,
      maxAttempts: preferences.max_follow_up_attempts,
      escalateAfterOverride: preferences.escalation_threshold_repeats,
    });

    if (decision.type === "no_op") {
      results.push({ occurrenceId: occ.id, reminderId: reminder.id, action: "waiting", reason: decision.reason });
      continue;
    }

    if (decision.type === "stop") {
      db.updateOccurrenceFollowUp(occ.id, { follow_up_state: "completed", next_follow_up_at: null });
      results.push({ occurrenceId: occ.id, reminderId: reminder.id, action: "stopped", reason: decision.reason });
      continue;
    }

    // decision.type === "send" — actually dispatch. A "send" only counts
    // as having happened, and only advances state, when the provider
    // genuinely reports success — never on "not_configured"/"failed".
    const outcome = await dispatch(provider, decision.channel, reminder, preferences.phone_number, now);
    const attemptNumber = occ.notification_attempt_count + 1;
    const escalationLevel = decision.escalated ? occ.escalation_level + 1 : occ.escalation_level;

    if (outcome.outcome === "sent") {
      const intervalMinutes = FOLLOW_UP_INTERVAL_MINUTES[reminder.intensity];
      const nextFollowUpAt = new Date(now.getTime() + intervalMinutes * 60_000).toISOString();
      const nextState: FollowUpState = decision.escalated
        ? "escalated"
        : decision.isFirst
          ? "notified"
          : "follow_up_sent";

      db.updateOccurrenceFollowUp(occ.id, {
        follow_up_state: nextState,
        notification_attempt_count: attemptNumber,
        escalation_level: escalationLevel,
        last_notified_at: now.toISOString(),
        next_follow_up_at: nextFollowUpAt,
      });
      if (decision.isFirst || nextState === "notified" || nextState === "follow_up_sent") {
        db.markOccurrenceNotified(occ.id, decision.escalated);
      }
    } else {
      // Delivery genuinely failed / not configured: record the honest
      // outcome but don't advance the attempt count or schedule a future
      // window as if it had gone out — that would silently swallow a real
      // attempt the person never received. A short retry window is set
      // instead so the next cron run tries again soon rather than looping
      // every invocation.
      db.updateOccurrenceFollowUp(occ.id, {
        follow_up_state: occ.notification_attempt_count === 0 ? "due" : occ.follow_up_state,
        next_follow_up_at: new Date(now.getTime() + 60_000).toISOString(),
      });
    }

    db.logNotification({
      reminderId: reminder.id,
      occurrenceId: occ.id,
      channel: decision.channel,
      message: buildNotificationMessage(reminder, occ.notification_attempt_count),
      outcome: outcome.outcome,
      attemptNumber,
      escalationLevel,
      providerRef: outcome.providerRef ?? null,
    });

    results.push({
      occurrenceId: occ.id,
      reminderId: reminder.id,
      action: outcome.outcome === "sent" ? "sent" : "skipped",
      channel: decision.channel,
      outcome: outcome.outcome,
    });
  }

  return results;
}

async function dispatch(
  provider: ReturnType<typeof getNotificationProvider>,
  channel: NotificationChannel,
  reminder: Reminder,
  escalationPhoneNumber: string | null,
  now: Date
) {
  const message = buildNotificationMessage(reminder);
  switch (channel) {
    case "push": {
      const payload = buildPushPayload(reminder);
      return provider.sendPush(reminder.user_id, JSON.stringify(payload));
    }
    case "sms":
      // The destination for sms/call escalation is the person's OWN
      // number, configured once in Settings (user_preferences.phone_number)
      // — deliberately not reminder.call?.phone_number, which is the
      // contact info for an unrelated "Call" reminder TYPE (e.g. "call the
      // dentist"). An unset number honestly fails validation downstream
      // rather than silently going nowhere.
      return provider.sendSms(escalationPhoneNumber ?? "", message);
    case "call":
      return provider.placeCall(escalationPhoneNumber ?? "", buildCallMessage(reminder, now));
    case "email":
    default:
      return provider.sendEmail(reminder.user_id, "NOVA reminder", message);
  }
}
