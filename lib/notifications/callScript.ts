import type { Reminder } from "@/types/reminder";

/**
 * Builds the spoken message for a phone-call escalation, entirely from the
 * reminder's own data (title + due state) — never hardcoded example
 * content. Kept separate from buildNotificationMessage (messages.ts)
 * because the call script is meant to be read aloud by Twilio's <Say>,
 * so it's phrased as a sentence rather than a short push-style label.
 */
export function dueStatePhrase(reminder: Reminder, now: Date = new Date()): string {
  const scheduled = `${reminder.date}${reminder.time ? `T${reminder.time}` : "T00:00"}`;
  const scheduledAt = new Date(scheduled);
  const today = now.toISOString().slice(0, 10);

  if (!Number.isNaN(scheduledAt.getTime()) && scheduledAt.getTime() < now.getTime()) {
    return "it is overdue";
  }
  if (reminder.date === today) {
    return "it is due today";
  }
  return "it is due now";
}

export function buildCallMessage(reminder: Reminder, now: Date = new Date()): string {
  const status = dueStatePhrase(reminder, now);
  return `Hello. This is NOVA. You have an important reminder. ${reminder.title}. It is ${status}. Please open NOVA and complete the reminder.`;
}

/**
 * XML-escapes text for safe inclusion inside a TwiML <Say> element.
 * Minimal, standard XML entity escaping — order matters (& first).
 */
export function escapeForTwiml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
