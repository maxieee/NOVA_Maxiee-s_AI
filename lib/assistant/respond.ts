// V7 — response generation. Concise, honest NOVA-voice replies. A failed
// execution must NEVER read as success (see ExecutionOutcome in
// executeIntent.ts — every branch here checks `ok` before praising anything).

import type { TodayViewModel } from "@/lib/scheduling/todayIntelligence";
import { formatFriendlyDate, formatTime } from "@/lib/utils/date";
import type { Reminder, PaymentAccount, PaymentCycle } from "@/types/reminder";

export function replyForCreated(reminder: Reminder, recurring: boolean): string {
  const when = formatFriendlyDate(reminder.date) + (reminder.time ? ` at ${formatTime(reminder.time)}` : "");
  return recurring
    ? `Done — I'll remind you to "${reminder.title}" starting ${when}, and it'll repeat.`
    : `Done — I'll remind you to "${reminder.title}" on ${when}.`;
}

export function replyForSnooze(reminder: Reminder, minutes: number): string {
  return `Snoozed "${reminder.title}" for ${minutes} minute${minutes === 1 ? "" : "s"} — I'll bring it back up.`;
}

export function replyForComplete(reminder: Reminder): string {
  return `Marked "${reminder.title}" as done. Nice work.`;
}

export function replyForUpdate(reminder: Reminder): string {
  const when = formatFriendlyDate(reminder.date) + (reminder.time ? ` at ${formatTime(reminder.time)}` : "");
  return `Moved "${reminder.title}" to ${when}.`;
}

export function replyForRemindAgain(reminder: Reminder): string {
  return `Sent you another nudge about "${reminder.title}".`;
}

export function replyForMarkPaid(account: PaymentAccount, cycle: PaymentCycle): string {
  return `Marked ${account.name} as paid for ${cycle.cycle_period}.`;
}

export function replyForFailure(action: string, detail?: string): string {
  return `I tried to ${action}, but it didn't go through${detail ? ` (${detail})` : ""}. Nothing changed — want me to try again?`;
}

export function replyForToday(view: TodayViewModel): string {
  const overdue = view.counts.overdue;
  const paymentsDue = view.counts.paymentsDueSoon;
  const total = view.needsAttention.length;
  if (total === 0) return "Nothing needing attention today. Nice work.";
  const upcomingCount = view.needsAttention.length - overdue - paymentsDue >= 0
    ? Math.max(0, total - overdue - paymentsDue)
    : 0;
  return `You have ${total} thing${total === 1 ? "" : "s"} needing attention today: ${overdue} overdue, ${paymentsDue} payment${paymentsDue === 1 ? "" : "s"} due today, ${upcomingCount} upcoming.`;
}

export function replyForOverdue(overdueTitles: string[]): string {
  if (overdueTitles.length === 0) return "Nothing overdue. You're all caught up.";
  return `You have ${overdueTitles.length} overdue: ${overdueTitles.join(", ")}.`;
}

export function replyForUpcoming(upcomingTitles: string[]): string {
  if (upcomingTitles.length === 0) return "Nothing upcoming beyond today.";
  return `Coming up: ${upcomingTitles.slice(0, 8).join(", ")}${upcomingTitles.length > 8 ? ", and more" : ""}.`;
}

export function replyForPayments(lines: string[]): string {
  if (lines.length === 0) return "No active payments on file.";
  return `Payments: ${lines.join("; ")}.`;
}
