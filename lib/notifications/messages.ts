import type { Reminder } from "@/types/reminder";

/** Builds a human-readable notification message for a reminder occurrence. */
export function buildNotificationMessage(reminder: Reminder, repeatCount = 0): string {
  const typeLabel = reminder.types.includes("payment") ? "Payment due" : "Reminder";
  const suffix = repeatCount > 0 ? ` (reminder #${repeatCount + 1})` : "";
  return `${typeLabel}: ${reminder.title}${suffix}`;
}

export function buildEscalationMessage(reminder: Reminder): string {
  return `Still pending: "${reminder.title}" needs your attention.`;
}
