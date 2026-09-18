import { describe, it, expect } from "vitest";
import { buildTodayViewModel } from "@/lib/scheduling/todayIntelligence";
import type { Reminder, PaymentAccount, PaymentCycle } from "@/types/reminder";

const NOW = new Date("2026-09-18T12:00:00");

function makeReminder(overrides: Partial<Reminder>): Reminder {
  return {
    id: "r1",
    user_id: "u1",
    title: "Test reminder",
    description: null,
    date: "2026-09-18",
    time: "09:00",
    priority: "medium",
    notes: null,
    status: "scheduled",
    created_at: "2026-09-01T00:00:00Z",
    updated_at: "2026-09-01T00:00:00Z",
    completed_at: null,
    types: ["task"],
    channels: [],
    intensity: "normal",
    ...overrides,
  };
}

function makeAccount(overrides: Partial<PaymentAccount>): PaymentAccount {
  return {
    id: "a1",
    user_id: "u1",
    name: "Test Card",
    payment_type: "CREDIT_CARD",
    issuer: null,
    masked_identifier: null,
    active: true,
    statement_date_rule: 1,
    due_date_rule: "fixed_day",
    fixed_due_day: 15,
    due_days_after_statement: null,
    default_amount: 100,
    minimum_amount: null,
    autopay_enabled: false,
    reminder_enabled: true,
    escalation_enabled: true,
    created_at: "2026-09-01T00:00:00Z",
    updated_at: "2026-09-01T00:00:00Z",
    ...overrides,
  };
}

function makeCycle(overrides: Partial<PaymentCycle>): PaymentCycle {
  return {
    id: "c1",
    payment_account_id: "a1",
    cycle_period: "2026-09",
    statement_date: "2026-09-01",
    due_date: "2026-09-18",
    amount: 100,
    minimum_amount: null,
    status: "due_today",
    paid_at: null,
    reminder_id: null,
    created_at: "2026-09-01T00:00:00Z",
    updated_at: "2026-09-01T00:00:00Z",
    ...overrides,
  };
}

describe("buildTodayViewModel", () => {
  it("produces a sensible empty view-model with no reminders or payments", () => {
    const view = buildTodayViewModel([], [], new Map(), NOW);
    expect(view.counts).toEqual({ urgent: 0, dueToday: 0, overdue: 0, completed: 0, paymentsDueSoon: 0 });
    expect(view.needsAttention).toEqual([]);
    expect(view.upcoming).toEqual([]);
    expect(view.completedToday).toEqual([]);
  });

  it("merges reminder-urgency output without recomputing it", () => {
    const overdueReminder = makeReminder({ id: "r-overdue", date: "2026-09-10" });
    const view = buildTodayViewModel([overdueReminder], [], new Map(), NOW);
    expect(view.counts.overdue).toBe(1);
    expect(view.needsAttention).toHaveLength(1);
    expect(view.needsAttention[0].source).toBe("reminder");
    expect(view.needsAttention[0].bucket).toBe("overdue");
  });

  it("merges payment-cycle-status output without recomputing it", () => {
    const account = makeAccount({ id: "a-1" });
    const cycle = makeCycle({ id: "c-overdue", payment_account_id: "a-1", due_date: "2026-09-10", status: "overdue" });
    const cyclesByAccount = new Map([["a-1", [cycle]]]);
    const view = buildTodayViewModel([], [account], cyclesByAccount, NOW);
    expect(view.needsAttention).toHaveLength(1);
    expect(view.needsAttention[0].source).toBe("payment");
    expect(view.needsAttention[0].bucket).toBe("overdue");
    expect(view.counts.paymentsDueSoon).toBe(1);
  });

  it("sorts needs-attention overdue before due-today before upcoming/due-soon", () => {
    const overdueReminder = makeReminder({ id: "r-overdue", date: "2026-09-10" });
    const account = makeAccount({ id: "a-1" });
    const dueTodayCycle = makeCycle({ id: "c-today", payment_account_id: "a-1", due_date: "2026-09-18", status: "due_today" });
    const dueSoonCycle = makeCycle({ id: "c-soon", payment_account_id: "a-1", due_date: "2026-09-20", status: "due_soon" });
    const cyclesByAccount = new Map([["a-1", [dueTodayCycle, dueSoonCycle]]]);
    // only the "next" (first non-paid) cycle per account is surfaced, so test with two accounts instead
    const account2 = makeAccount({ id: "a-2" });
    const cyclesByAccount2 = new Map([
      ["a-1", [dueTodayCycle]],
      ["a-2", [dueSoonCycle]],
    ]);
    const view = buildTodayViewModel([overdueReminder], [account, account2], cyclesByAccount2, NOW);
    expect(view.needsAttention.map((i) => i.bucket)).toEqual(["overdue", "due_today", "due_soon"]);
    void cyclesByAccount;
  });

  it("tags a reminder and a payment cycle due on the same day correctly in upcoming", () => {
    const upcomingReminder = makeReminder({ id: "r-upcoming", date: "2026-09-30" });
    const account = makeAccount({ id: "a-1" });
    const upcomingCycle = makeCycle({ id: "c-upcoming", payment_account_id: "a-1", due_date: "2026-09-30", status: "upcoming" });
    const cyclesByAccount = new Map([["a-1", [upcomingCycle]]]);
    const view = buildTodayViewModel([upcomingReminder], [account], cyclesByAccount, NOW);
    expect(view.upcoming).toHaveLength(1);
    expect(view.upcoming[0].date).toBe("2026-09-30");
    const sources = view.upcoming[0].items.map((i) => i.source).sort();
    expect(sources).toEqual(["payment", "reminder"]);
  });

  it("includes completed-today items from both reminders and paid-today cycles", () => {
    const completedReminder = makeReminder({
      id: "r-done",
      status: "completed",
      completed_at: NOW.toISOString(),
    });
    const account = makeAccount({ id: "a-1" });
    const paidCycle = makeCycle({
      id: "c-paid",
      payment_account_id: "a-1",
      status: "paid",
      paid_at: NOW.toISOString(),
    });
    const cyclesByAccount = new Map([["a-1", [paidCycle]]]);
    const view = buildTodayViewModel([completedReminder], [account], cyclesByAccount, NOW);
    expect(view.completedToday).toHaveLength(2);
    const sources = view.completedToday.map((i) => i.source).sort();
    expect(sources).toEqual(["payment", "reminder"]);
  });
});
