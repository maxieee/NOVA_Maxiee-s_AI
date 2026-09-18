import { db } from "@/lib/db";
import { computeNextStatementDate, computeDueDateForStatement, cyclePeriodFor } from "@/lib/scheduling/paymentDates";
import { toISODate } from "@/lib/utils/date";
import type { PaymentAccount, PaymentCycle, PaymentCycleStatus } from "@/types/reminder";

/** Days-before-due at which a cycle is considered "due soon" rather than merely "upcoming". */
const DUE_SOON_WINDOW_DAYS = 7;

/**
 * Pure derivation of a payment_cycle's domain-level status from its
 * due_date and "now" — deliberately separate from reminder_occurrences'
 * follow_up_state, which tracks the notification state machine. A cycle
 * already marked "paid" (via Mark Paid) is never overwritten here.
 */
export function derivePaymentCycleStatus(dueDateISO: string, now: Date, currentStatus?: PaymentCycleStatus): PaymentCycleStatus {
  if (currentStatus === "paid") return "paid";
  const due = new Date(`${dueDateISO}T00:00:00`);
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const diffDays = Math.round((due.getTime() - today.getTime()) / 86_400_000);

  if (diffDays < 0) return "overdue";
  if (diffDays === 0) return "due_today";
  if (diffDays <= DUE_SOON_WINDOW_DAYS) return "due_soon";
  return "upcoming";
}

/**
 * Ensures the next upcoming payment_cycle exists for a given account.
 * Idempotent: checks for an existing cycle at the computed period before
 * inserting (and the DB's unique(payment_account_id, cycle_period)
 * constraint backs this up), so calling it any number of times for the
 * same "now" never creates duplicate cycles.
 */
export async function ensureUpcomingCycle(account: PaymentAccount, now: Date = new Date()): Promise<PaymentCycle> {
  const statementDate = computeNextStatementDate(account.statement_date_rule, now);
  const dueDate = computeDueDateForStatement(
    statementDate,
    account.due_date_rule,
    account.fixed_due_day,
    account.due_days_after_statement
  );
  const cyclePeriod = cyclePeriodFor(statementDate);

  const existing = await db.getPaymentCycleByPeriod(account.id, cyclePeriod);
  if (existing) return existing;

  return await db.createPaymentCycle(account.id, {
    cyclePeriod,
    statementDate: toISODate(statementDate),
    dueDate: toISODate(dueDate),
    amount: account.default_amount,
    minimumAmount: account.minimum_amount,
  });
}

/**
 * For every active payment_account belonging to the user, ensure its next
 * upcoming cycle exists. Disabled accounts are skipped — disabling an
 * account stops future cycle/reminder generation without deleting history.
 */
export async function generateMissingCycles(userId: string, now: Date = new Date()): Promise<PaymentCycle[]> {
  const accounts = (await db.listPaymentAccounts(userId)).filter((a) => a.active);
  return Promise.all(accounts.map((a) => ensureUpcomingCycle(a, now)));
}

/**
 * Recomputes and persists payment_cycles.status for every cycle of every
 * account belonging to the user, from due_date vs now. Never touches an
 * already-"paid" cycle.
 */
export async function refreshCycleStatuses(userId: string, now: Date = new Date()): Promise<void> {
  const accounts = await db.listPaymentAccounts(userId);
  for (const account of accounts) {
    for (const cycle of await db.listPaymentCycles(account.id)) {
      const next = derivePaymentCycleStatus(cycle.due_date, now, cycle.status);
      if (next !== cycle.status) {
        await db.updatePaymentCycleStatus(cycle.id, next);
      }
    }
  }
}
