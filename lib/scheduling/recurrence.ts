import type { RecurrenceRule } from "@/types/reminder";

/**
 * Pure recurrence math: given a rule and the last fired date, compute the
 * next occurrence date. No DB / IO here so it is trivially unit-testable.
 */
export function computeNextOccurrence(
  rule: Pick<RecurrenceRule, "frequency" | "interval" | "by_weekday" | "by_day_of_month" | "ends_at" | "occurrences_limit">,
  fromDate: Date,
  occurrencesSoFar = 0
): Date | null {
  if (rule.occurrences_limit != null && occurrencesSoFar >= rule.occurrences_limit) {
    return null;
  }

  const next = new Date(fromDate);
  const interval = Math.max(1, rule.interval || 1);

  switch (rule.frequency) {
    case "daily":
      next.setDate(next.getDate() + interval);
      break;
    case "weekly":
      if (rule.by_weekday && rule.by_weekday.length > 0) {
        next.setDate(next.getDate() + 1);
        let guard = 0;
        while (!rule.by_weekday.includes(next.getDay()) && guard < 14) {
          next.setDate(next.getDate() + 1);
          guard += 1;
        }
      } else {
        next.setDate(next.getDate() + 7 * interval);
      }
      break;
    case "monthly": {
      const originalDay = next.getDate();
      next.setDate(1); // avoid month-overflow when the current day doesn't exist in the target month
      next.setMonth(next.getMonth() + interval);
      const targetDay = rule.by_day_of_month ?? originalDay;
      next.setDate(Math.min(targetDay, daysInMonth(next)));
      break;
    }
    case "yearly":
      next.setFullYear(next.getFullYear() + interval);
      break;
    case "custom_days":
      next.setDate(next.getDate() + interval);
      break;
    default:
      return null;
  }

  if (rule.ends_at) {
    const end = new Date(rule.ends_at);
    if (next.getTime() > end.getTime()) return null;
  }

  return next;
}

function daysInMonth(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
}

/**
 * Payment-style multi-lead-time schedule: given a due date and a list of
 * "days before" lead times (e.g. [7,3,1]), returns the ISO datetimes at
 * which a notification should first fire, plus the due-date morning itself.
 */
export function computeLeadTimeSchedule(
  dueDate: Date,
  leadDays: number[],
  morningHour = 9
): Date[] {
  const dates: Date[] = [];
  for (const lead of leadDays) {
    const d = new Date(dueDate);
    d.setDate(d.getDate() - lead);
    d.setHours(morningHour, 0, 0, 0);
    dates.push(d);
  }
  const dueMorning = new Date(dueDate);
  dueMorning.setHours(morningHour, 0, 0, 0);
  dates.push(dueMorning);
  return dates.sort((a, b) => a.getTime() - b.getTime());
}

/**
 * Repeat/escalation logic for an unacknowledged reminder:
 * Notification -> Wait -> Repeat -> Escalate (after N repeats) -> continues.
 */
export interface RepeatState {
  repeatCount: number;
  escalated: boolean;
}

export function computeNextRepeat(
  lastFired: Date,
  state: RepeatState,
  repeatIntervalMinutes: number,
  escalationEnabled: boolean,
  escalateAfterRepeats = 3
): { nextFireAt: Date; state: RepeatState } {
  const nextFireAt = new Date(lastFired.getTime() + repeatIntervalMinutes * 60_000);
  const repeatCount = state.repeatCount + 1;
  const escalated =
    state.escalated || (escalationEnabled && repeatCount >= escalateAfterRepeats);

  return { nextFireAt, state: { repeatCount, escalated } };
}
