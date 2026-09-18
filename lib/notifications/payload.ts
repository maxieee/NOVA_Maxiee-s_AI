import type { Reminder, ReminderIntensity } from "@/types/reminder";

/**
 * Shape of the payload sent to the Web Push service and, in turn, to
 * `self.registration.showNotification` in the service worker. Kept small —
 * push payloads are size-limited by browsers/push services.
 */
export interface PushNotificationPayload {
  title: string;
  body: string;
  data: {
    url: string;
    reminderId: string;
  };
  actions: { action: "done" | "snooze"; title: string }[];
}

function isUrgent(intensity: ReminderIntensity): boolean {
  return intensity === "persistent" || intensity === "critical";
}

function dueDescription(reminder: Reminder): string {
  const today = new Date().toISOString().slice(0, 10);
  if (reminder.date === today) {
    return reminder.time ? `is due today at ${reminder.time}` : "is due today";
  }
  return reminder.time ? `is due at ${reminder.time}` : `is due on ${reminder.date}`;
}

/** Builds a concise push title/body/data/actions payload for a reminder. */
export function buildPushPayload(reminder: Reminder): PushNotificationPayload {
  const urgent = isUrgent(reminder.intensity);
  const title = urgent ? "NOVA 🚨" : "NOVA 🔔";
  const body = urgent
    ? `Important reminder: ${reminder.title} is due now.`
    : `${reminder.title} ${dueDescription(reminder)}.`;

  return {
    title,
    body,
    data: {
      url: `/reminders/${reminder.id}`,
      reminderId: reminder.id,
    },
    actions: [
      { action: "done", title: "Done" },
      { action: "snooze", title: "Snooze" },
    ],
  };
}
