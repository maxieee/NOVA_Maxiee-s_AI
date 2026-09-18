import { addDays, setDate, addMonths, getDaysInMonth } from "date-fns";
import type { DueDateRule } from "@/types/reminder";

/**
 * Pure date math for payment accounts. No IO here so it is trivially
 * unit-testable and reused identically by cycle generation and by the UI's
 * "next due date" preview.
 *
 * Clamping rule: a configured day-of-month (statement_date_rule,
 * fixed_due_day) that doesn't exist in the target month (e.g. "31" in
 * April, or "29" in a non-leap February) clamps DOWN to the last real day
 * of that month — never rolls over into the next month. This matches how
 * banks describe "statement closes on the 31st (or month-end)".
 */
function clampDayOfMonth(date: Date, day: number): Date {
  const lastDay = getDaysInMonth(date);
  return setDate(date, Math.min(Math.max(day, 1), lastDay));
}

/**
 * Next statement date on/after `from`, for a given day-of-month rule.
 * If today's clamped statement date for the current month has already
 * passed relative to `from`, rolls forward to next month.
 */
export function computeNextStatementDate(statementDateRule: number, from: Date): Date {
  const thisMonth = clampDayOfMonth(from, statementDateRule);
  if (startOfDay(thisMonth).getTime() >= startOfDay(from).getTime()) {
    return thisMonth;
  }
  return clampDayOfMonth(addMonths(from, 1), statementDateRule);
}

export function computeDueDateForStatement(
  statementDate: Date,
  rule: DueDateRule,
  fixedDueDay: number | null,
  dueDaysAfterStatement: number | null
): Date {
  if (rule === "days_after_statement") {
    const n = dueDaysAfterStatement ?? 0;
    return addDays(statementDate, n);
  }
  // fixed_day: due on a fixed day-of-month, in the month at/after the
  // statement date (typically the following month for a credit card).
  const day = fixedDueDay ?? statementDate.getDate();
  const candidate = clampDayOfMonth(statementDate, day);
  if (candidate.getTime() > statementDate.getTime()) return candidate;
  return clampDayOfMonth(addMonths(statementDate, 1), day);
}

export function cyclePeriodFor(statementDate: Date): string {
  const y = statementDate.getFullYear();
  const m = String(statementDate.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

function startOfDay(d: Date): Date {
  const c = new Date(d);
  c.setHours(0, 0, 0, 0);
  return c;
}
