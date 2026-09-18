import { db } from "@/lib/db";
import { decideEscalation } from "@/lib/notifications/escalation";
import { getNotificationProvider, isTwilioConfigured, isWebPushConfigured } from "@/lib/notifications/providers";
import { buildPushPayload } from "@/lib/notifications/payload";
import { buildNotificationMessage } from "@/lib/notifications/messages";
import type { NotificationChannel, Reminder } from "@/types/reminder";

export interface DueScanResult {
  occurrenceId: string;
  reminderId: string;
  action: "notified" | "waited" | "stopped";
  channel?: NotificationChannel;
  outcome?: string;
}

function configuredChannels(): NotificationChannel[] {
  const channels: NotificationChannel[] = [];
  if (isWebPushConfigured()) channels.push("push");
  if (isTwilioConfigured()) channels.push("sms", "call");
  return channels;
}

function minutesSince(iso: string): number {
  return (Date.now() - new Date(iso).getTime()) / 60_000;
}

/**
 * Server-side "source of truth" scan: finds occurrences that are due and
 * not yet acknowledged, runs the escalation engine against them, and — if
 * the engine says to notify now — actually dispatches via the provider
 * abstraction (push/sms/call) and logs the real outcome. No client timer
 * is trusted; this is meant to be invoked by a real scheduler (see
 * POST /api/cron/process-due-reminders).
 */
export async function scanAndProcessDueReminders(): Promise<DueScanResult[]> {
  const userId = db.getCurrentUserId();
  const now = new Date();
  const occurrences = db.listUpcomingOccurrences(userId);
  const available = configuredChannels();
  const provider = getNotificationProvider();
  const results: DueScanResult[] = [];

  for (const occ of occurrences) {
    if (new Date(occ.scheduled_for) > now) continue; // not due yet
    const reminder: Reminder = occ.reminder;

    const action = decideEscalation({
      intensity: reminder.intensity,
      requestedChannels: reminder.channels.length ? reminder.channels : ["push"],
      configuredChannels: available,
      elapsedMinutes: minutesSince(occ.scheduled_for),
      acknowledged: reminder.status === "completed",
      repeatCount: occ.repeat_count,
    });

    if (action.type === "wait") {
      results.push({ occurrenceId: occ.id, reminderId: reminder.id, action: "waited" });
      continue;
    }
    if (action.type === "stop") {
      results.push({ occurrenceId: occ.id, reminderId: reminder.id, action: "stopped" });
      continue;
    }

    const outcome = await dispatch(provider, action.channel, reminder);
    db.markOccurrenceNotified(occ.id, action.escalated);
    db.logNotification({
      reminderId: reminder.id,
      occurrenceId: occ.id,
      channel: action.channel,
      message: buildNotificationMessage(reminder, occ.repeat_count),
      outcome: outcome.outcome,
    });

    results.push({
      occurrenceId: occ.id,
      reminderId: reminder.id,
      action: "notified",
      channel: action.channel,
      outcome: outcome.outcome,
    });
  }

  return results;
}

async function dispatch(
  provider: ReturnType<typeof getNotificationProvider>,
  channel: NotificationChannel,
  reminder: Reminder
) {
  const message = buildNotificationMessage(reminder);
  switch (channel) {
    case "push": {
      const payload = buildPushPayload(reminder);
      return provider.sendPush(reminder.user_id, JSON.stringify(payload));
    }
    case "sms":
      return provider.sendSms(reminder.call?.phone_number ?? "", message);
    case "call":
      return provider.placeCall(reminder.call?.phone_number ?? "", message);
    case "email":
    default:
      return provider.sendEmail(reminder.user_id, "NOVA reminder", message);
  }
}
