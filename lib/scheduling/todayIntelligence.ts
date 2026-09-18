import type { Reminder, PaymentAccount, PaymentCycle } from "@/types/reminder";
import {
  getUrgency,
  computeDashboardCounts,
  getNeedsAttention,
  groupUpcomingByDay,
} from "@/lib/scheduling/urgency";
import { derivePaymentCycleStatus } from "@/lib/scheduling/paymentCycles";

/**
 * V6 "Today Command Center" unified aggregation layer.
 *
 * This module composes the EXISTING pure scheduling logic
 * (lib/scheduling/urgency.ts for reminders, lib/scheduling/paymentCycles.ts
 * for payment cycles) into one merged, typed view model for the Today page.
 * It intentionally does NOT reimplement any due-date/urgency/status math —
 * every bucket a reminder or payment cycle lands in is decided entirely by
 * getUrgency()/derivePaymentCycleStatus(); this file only merges, tags and
 * sorts those already-computed results.
 */

export type TodayItemSource = "reminder" | "payment";

/** A single tagged, renderable+actionable item in the unified Today view. */
export interface TodayItem {
  source: TodayItemSource;
  id: string; // reminder.id, or payment_cycle.id for payments
  title: string;
  /** ISO date (yyyy-mm-dd) the item is due on. */
  date: string;
  /** HH:mm time, if any (reminders only — payment cycles are date-only). */
  time: string | null;
  /** The underlying urgency/status bucket, using each domain's own vocabulary. */
  bucket: "overdue" | "urgent" | "due_today" | "due_soon" | "upcoming" | "completed";
  /** Sort key (ms since epoch) used for ordering within a bucket/day. */
  sortAt: number;
  /** Opaque payload for rendering: the original reminder or {account, cycle}. */
  reminder?: Reminder;
  payment?: { account: PaymentAccount; cycle: PaymentCycle };
}

export interface TodayUpcomingGroup {
  date: string;
  items: TodayItem[];
}

export interface TodayViewModel {
  counts: {
    urgent: number;
    dueToday: number;
    overdue: number;
    completed: number;
    /** Payment cycles due today or due-soon — surfaced adjacently, not merged
     * into `dueToday`, so the existing reminder-only "Due Today" stat tile
     * (already covered by 104 passing tests and the payments page's own
     * stat tiles) keeps its exact prior meaning. */
    paymentsDueSoon: number;
  };
  needsAttention: TodayItem[];
  upcoming: TodayUpcomingGroup[];
  completedToday: TodayItem[];
}

function reminderSortAt(r: Reminder): number {
  const time = r.time ?? "23:59";
  return new Date(`${r.date}T${time}:00`).getTime();
}

function paymentSortAt(cycle: PaymentCycle): number {
  return new Date(`${cycle.due_date}T12:00:00`).getTime();
}

function reminderToItem(r: Reminder, now: Date): TodayItem {
  const urgency = getUrgency(r, now);
  return {
    source: "reminder",
    id: r.id,
    title: r.title,
    date: r.date,
    time: r.time,
    bucket: urgency,
    sortAt: reminderSortAt(r),
    reminder: r,
  };
}

function paymentToItem(account: PaymentAccount, cycle: PaymentCycle, now: Date): TodayItem {
  const status = derivePaymentCycleStatus(cycle.due_date, now, cycle.status);
  const bucket = status === "paid" ? "completed" : status;
  return {
    source: "payment",
    id: cycle.id,
    title: account.name,
    date: cycle.due_date,
    time: null,
    bucket,
    sortAt: paymentSortAt(cycle),
    payment: { account, cycle },
  };
}

/** Latest non-paid cycle per account (mirrors app/payments/page.tsx's own selection logic). */
function latestActiveCycles(accounts: PaymentAccount[], cyclesByAccount: Map<string, PaymentCycle[]>): Array<{ account: PaymentAccount; cycle: PaymentCycle }> {
  const out: Array<{ account: PaymentAccount; cycle: PaymentCycle }> = [];
  for (const account of accounts) {
    if (!account.active) continue;
    const cycles = cyclesByAccount.get(account.id) ?? [];
    const next = cycles.find((c) => c.status !== "paid") ?? null;
    if (next) out.push({ account, cycle: next });
  }
  return out;
}

/** Payment cycles paid today, for the completed-today section. */
function paidTodayCycles(accounts: PaymentAccount[], cyclesByAccount: Map<string, PaymentCycle[]>, now: Date): Array<{ account: PaymentAccount; cycle: PaymentCycle }> {
  const out: Array<{ account: PaymentAccount; cycle: PaymentCycle }> = [];
  for (const account of accounts) {
    const cycles = cyclesByAccount.get(account.id) ?? [];
    for (const cycle of cycles) {
      if (
        cycle.status === "paid" &&
        cycle.paid_at &&
        new Date(cycle.paid_at).toDateString() === now.toDateString()
      ) {
        out.push({ account, cycle });
      }
    }
  }
  return out;
}

const BUCKET_ORDER: Record<TodayItem["bucket"], number> = {
  overdue: 0,
  urgent: 1,
  due_today: 2,
  due_soon: 3,
  upcoming: 4,
  completed: 5,
};

function sortItems(items: TodayItem[]): TodayItem[] {
  return [...items].sort((a, b) => {
    const bucketDiff = BUCKET_ORDER[a.bucket] - BUCKET_ORDER[b.bucket];
    if (bucketDiff !== 0) return bucketDiff;
    return a.sortAt - b.sortAt;
  });
}

/**
 * Build the unified Today view model from reminders and payment
 * account/cycle data already loaded via the existing DataLayer.
 *
 * `paymentCyclesByAccount` maps payment_account_id -> that account's
 * payment_cycles (as returned by await db.listPaymentCycles per account) so this
 * function never touches the DB itself and stays pure/unit-testable.
 */
export function buildTodayViewModel(
  reminders: Reminder[],
  paymentAccounts: PaymentAccount[],
  paymentCyclesByAccount: Map<string, PaymentCycle[]>,
  now: Date = new Date()
): TodayViewModel {
  // Reminder-side aggregates: delegate entirely to the existing urgency.ts.
  const reminderCounts = computeDashboardCounts(reminders, now);
  const reminderNeedsAttention = getNeedsAttention(reminders, now).map((r) => reminderToItem(r, now));
  const reminderUpcomingGroups = groupUpcomingByDay(reminders, now);

  // Payment-side aggregates: delegate entirely to the existing paymentCycles.ts.
  const activeCycles = latestActiveCycles(paymentAccounts, paymentCyclesByAccount);
  const paymentItems = activeCycles.map(({ account, cycle }) => paymentToItem(account, cycle, now));
  const paymentsNeedsAttention = paymentItems.filter(
    (i) => i.bucket === "overdue" || i.bucket === "due_today" || i.bucket === "due_soon"
  );
  const paymentsUpcoming = paymentItems.filter((i) => i.bucket === "upcoming");

  const paidToday = paidTodayCycles(paymentAccounts, paymentCyclesByAccount, now).map(({ account, cycle }) =>
    paymentToItem(account, cycle, now)
  );

  // Merge needs-attention across both sources, sorted overdue-first.
  const needsAttention = sortItems([...reminderNeedsAttention, ...paymentsNeedsAttention]);

  // Merge upcoming-by-day: start from reminders' own day groups (preserving
  // their date keys/order) and fold in payment cycles due on those same
  // days, adding new day groups for payment-only dates.
  const groupMap = new Map<string, TodayItem[]>();
  for (const group of reminderUpcomingGroups) {
    groupMap.set(group.date, group.items.map((r) => reminderToItem(r, now)));
  }
  for (const item of paymentsUpcoming) {
    if (!groupMap.has(item.date)) groupMap.set(item.date, []);
    groupMap.get(item.date)!.push(item);
  }

  const upcoming: TodayUpcomingGroup[] = Array.from(groupMap.entries())
    .map(([date, items]) => ({ date, items: sortItems(items) }))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  const completedToday = sortItems([
    ...reminders
      .filter(
        (r) =>
          (r.status === "completed" || r.status === "cancelled") &&
          r.completed_at &&
          new Date(r.completed_at).toDateString() === now.toDateString()
      )
      .map((r) => reminderToItem(r, now)),
    ...paidToday,
  ]);

  return {
    counts: {
      urgent: reminderCounts.urgent,
      dueToday: reminderCounts.dueToday,
      overdue: reminderCounts.overdue,
      completed: reminderCounts.completed,
      paymentsDueSoon: paymentItems.filter(
        (i) => i.bucket === "overdue" || i.bucket === "due_today" || i.bucket === "due_soon"
      ).length,
    },
    needsAttention,
    upcoming,
    completedToday,
  };
}
