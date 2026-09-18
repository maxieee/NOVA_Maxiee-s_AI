import type { Reminder, Urgency, DashboardCounts } from "@/types/reminder";

/**
 * Pure, side-effect free scheduling/business logic. No DB access, no React.
 * Kept separate so it can be unit tested in isolation (see tests/).
 */

export function reminderDateTime(reminder: Pick<Reminder, "date" | "time">): Date {
  const time = reminder.time ?? "23:59";
  return new Date(`${reminder.date}T${time}:00`);
}

export function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/**
 * Determine the urgency bucket for a reminder relative to `now`.
 * Completed/cancelled reminders are always "completed" (i.e. resolved).
 */
export function getUrgency(reminder: Reminder, now: Date = new Date()): Urgency {
  if (reminder.status === "completed" || reminder.status === "cancelled") {
    return "completed";
  }

  const due = reminderDateTime(reminder);

  if (due.getTime() < now.getTime() && !isSameDay(due, now)) {
    return "overdue";
  }

  if (isSameDay(due, now)) {
    return "due_today";
  }

  if (reminder.priority === "urgent") {
    return "urgent";
  }

  return "upcoming";
}

export function computeDashboardCounts(reminders: Reminder[], now: Date = new Date()): DashboardCounts {
  const counts: DashboardCounts = { urgent: 0, dueToday: 0, overdue: 0, completed: 0 };

  for (const r of reminders) {
    const urgency = getUrgency(r, now);
    switch (urgency) {
      case "overdue":
        counts.overdue += 1;
        break;
      case "due_today":
        counts.dueToday += 1;
        break;
      case "urgent":
        counts.urgent += 1;
        break;
      case "completed":
        counts.completed += 1;
        break;
      default:
        break;
    }
  }

  return counts;
}

/** Reminders that need attention: overdue or urgent, not yet completed. */
export function getNeedsAttention(reminders: Reminder[], now: Date = new Date()): Reminder[] {
  return reminders
    .filter((r) => {
      const u = getUrgency(r, now);
      return u === "overdue" || u === "urgent" || u === "due_today";
    })
    .sort((a, b) => reminderDateTime(a).getTime() - reminderDateTime(b).getTime());
}

/** Upcoming (future, not due today) reminders grouped by ISO date. */
export function groupUpcomingByDay(
  reminders: Reminder[],
  now: Date = new Date()
): Array<{ date: string; items: Reminder[] }> {
  const upcoming = reminders
    .filter((r) => {
      if (r.status === "completed" || r.status === "cancelled") return false;
      const due = reminderDateTime(r);
      return due.getTime() > now.getTime() && !isSameDay(due, now);
    })
    .sort((a, b) => reminderDateTime(a).getTime() - reminderDateTime(b).getTime());

  const groups = new Map<string, Reminder[]>();
  for (const r of upcoming) {
    const key = r.date;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(r);
  }

  return Array.from(groups.entries()).map(([date, items]) => ({ date, items }));
}

export const URGENCY_LABEL: Record<Urgency, string> = {
  overdue: "Overdue",
  urgent: "Urgent",
  due_today: "Due Today",
  upcoming: "Upcoming",
  completed: "Completed",
};

export const URGENCY_COLOR: Record<Urgency, string> = {
  overdue: "text-nova-urgent",
  urgent: "text-nova-warn",
  due_today: "text-nova-accent",
  upcoming: "text-nova-muted",
  completed: "text-nova-good",
};
