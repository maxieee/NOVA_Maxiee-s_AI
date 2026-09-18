import { describe, it, expect } from "vitest";
import { isWithinQuietHours } from "../lib/proactive/quietHours";
import {
  paymentDueSoonRule,
  paymentOverdueRule,
  reminderIgnoredRule,
  reminderApproachingRule,
  overdueClusterRule,
  recurringMissedRule,
} from "../lib/proactive/rules";
import type { ProactiveRuleContext } from "../lib/proactive/types";
import type { PaymentAccount, PaymentCycle, Reminder, ReminderOccurrence } from "../types/reminder";

const NOW = new Date("2026-06-15T10:00:00Z");

function baseReminder(overrides: Partial<Reminder> = {}): Reminder {
  return {
    id: "r1",
    user_id: "u1",
    title: "Test reminder",
    description: null,
    date: "2026-06-15",
    time: "12:00",
    priority: "medium",
    notes: null,
    status: "scheduled",
    created_at: NOW.toISOString(),
    updated_at: NOW.toISOString(),
    completed_at: null,
    types: ["task"],
    payment: null,
    call: null,
    meeting: null,
    follow_up: null,
    recurrence: null,
    next_occurrence: null,
    channels: ["push"],
    intensity: "normal",
    ...overrides,
  };
}

function baseAccount(overrides: Partial<PaymentAccount> = {}): PaymentAccount {
  return {
    id: "acc1",
    user_id: "u1",
    name: "Visa",
    payment_type: "CREDIT_CARD",
    issuer: null,
    masked_identifier: null,
    active: true,
    statement_date_rule: 1,
    due_date_rule: "fixed_day",
    fixed_due_day: 20,
    due_days_after_statement: null,
    default_amount: 100,
    minimum_amount: null,
    autopay_enabled: false,
    reminder_enabled: true,
    escalation_enabled: true,
    created_at: NOW.toISOString(),
    updated_at: NOW.toISOString(),
    ...overrides,
  };
}

function baseCycle(overrides: Partial<PaymentCycle> = {}): PaymentCycle {
  return {
    id: "cyc1",
    payment_account_id: "acc1",
    cycle_period: "2026-06",
    statement_date: "2026-06-01",
    due_date: "2026-06-20",
    amount: 100,
    minimum_amount: null,
    status: "upcoming",
    paid_at: null,
    reminder_id: null,
    created_at: NOW.toISOString(),
    updated_at: NOW.toISOString(),
    ...overrides,
  };
}

function emptyContext(overrides: Partial<ProactiveRuleContext> = {}): ProactiveRuleContext {
  return { now: NOW, reminders: [], occurrences: [], paymentCycles: [], ...overrides };
}

describe("paymentDueSoonRule", () => {
  it("fires when a cycle is due_soon or due_today", () => {
    const ctx = emptyContext({
      paymentCycles: [{ account: baseAccount(), cycle: baseCycle({ status: "due_today" }) }],
    });
    const events = paymentDueSoonRule.evaluate(ctx);
    expect(events).toHaveLength(1);
    expect(events[0].subjectId).toBe("cyc1");
    expect(events[0].priority).toBe("high");
  });

  it("does not fire for upcoming or overdue cycles", () => {
    const ctx = emptyContext({
      paymentCycles: [
        { account: baseAccount(), cycle: baseCycle({ status: "upcoming" }) },
        { account: baseAccount(), cycle: baseCycle({ id: "cyc2", status: "overdue" }) },
      ],
    });
    expect(paymentDueSoonRule.evaluate(ctx)).toHaveLength(0);
  });
});

describe("paymentOverdueRule", () => {
  it("fires only for overdue cycles", () => {
    const ctx = emptyContext({
      paymentCycles: [{ account: baseAccount(), cycle: baseCycle({ status: "overdue" }) }],
    });
    expect(paymentOverdueRule.evaluate(ctx)).toHaveLength(1);
  });

  it("does not fire for due_soon", () => {
    const ctx = emptyContext({
      paymentCycles: [{ account: baseAccount(), cycle: baseCycle({ status: "due_soon" }) }],
    });
    expect(paymentOverdueRule.evaluate(ctx)).toHaveLength(0);
  });
});

function occ(overrides: Partial<ReminderOccurrence & { reminder: Reminder }> = {}) {
  return {
    id: "occ1",
    reminder_id: "r1",
    scheduled_for: "2026-06-15T09:00:00",
    fired_at: null,
    status: "fired" as const,
    repeat_count: 3,
    escalated: false,
    follow_up_state: "follow_up_sent" as const,
    notification_attempt_count: 3,
    escalation_level: 0,
    last_notified_at: null,
    next_follow_up_at: null,
    reminder: baseReminder(),
    ...overrides,
  };
}

describe("reminderIgnoredRule", () => {
  it("fires once attempt count reaches the threshold", () => {
    const ctx = emptyContext({ occurrences: [occ({ notification_attempt_count: 3 })] });
    expect(reminderIgnoredRule.evaluate(ctx)).toHaveLength(1);
  });

  it("does not fire below the threshold", () => {
    const ctx = emptyContext({ occurrences: [occ({ notification_attempt_count: 1 })] });
    expect(reminderIgnoredRule.evaluate(ctx)).toHaveLength(0);
  });

  it("does not fire once completed", () => {
    const ctx = emptyContext({
      occurrences: [occ({ notification_attempt_count: 5, follow_up_state: "completed" })],
    });
    expect(reminderIgnoredRule.evaluate(ctx)).toHaveLength(0);
  });
});

describe("reminderApproachingRule", () => {
  it("fires for an urgent reminder due within the window", () => {
    const ctx = emptyContext({
      reminders: [baseReminder({ priority: "urgent", date: "2026-06-15", time: "11:00", status: "scheduled" })],
    });
    expect(reminderApproachingRule.evaluate(ctx)).toHaveLength(1);
  });

  it("does not fire for a medium-priority reminder", () => {
    const ctx = emptyContext({
      reminders: [baseReminder({ priority: "medium", date: "2026-06-15", time: "11:00" })],
    });
    expect(reminderApproachingRule.evaluate(ctx)).toHaveLength(0);
  });

  it("does not fire once NOVA's own engine already notified it", () => {
    const ctx = emptyContext({
      reminders: [baseReminder({ priority: "urgent", date: "2026-06-15", time: "11:00", status: "notified" })],
    });
    expect(reminderApproachingRule.evaluate(ctx)).toHaveLength(0);
  });

  it("does not fire far in the future", () => {
    const ctx = emptyContext({
      reminders: [baseReminder({ priority: "urgent", date: "2026-06-20", time: "11:00" })],
    });
    expect(reminderApproachingRule.evaluate(ctx)).toHaveLength(0);
  });
});

describe("overdueClusterRule", () => {
  it("fires one event when 3+ reminders are overdue", () => {
    const overdue = [1, 2, 3].map((n) =>
      baseReminder({ id: `r${n}`, date: "2026-06-01", time: "09:00", status: "scheduled" })
    );
    const ctx = emptyContext({ reminders: overdue });
    const events = overdueClusterRule.evaluate(ctx);
    expect(events).toHaveLength(1);
    expect(events[0].subjectId).toBe("overdue_cluster");
  });

  it("does not fire below the cluster threshold", () => {
    const ctx = emptyContext({
      reminders: [baseReminder({ date: "2026-06-01", time: "09:00", status: "scheduled" })],
    });
    expect(overdueClusterRule.evaluate(ctx)).toHaveLength(0);
  });
});

describe("isWithinQuietHours", () => {
  it("returns false when no quiet hours are configured", () => {
    expect(isWithinQuietHours(new Date("2026-06-15T23:30:00"), null, null)).toBe(false);
  });

  it("detects an overnight window (22:00-07:00)", () => {
    expect(isWithinQuietHours(new Date("2026-06-15T23:30:00"), "22:00", "07:00")).toBe(true);
    expect(isWithinQuietHours(new Date("2026-06-15T06:59:00"), "22:00", "07:00")).toBe(true);
    expect(isWithinQuietHours(new Date("2026-06-15T12:00:00"), "22:00", "07:00")).toBe(false);
  });

  it("detects a same-day window", () => {
    expect(isWithinQuietHours(new Date("2026-06-15T13:30:00"), "13:00", "14:00")).toBe(true);
    expect(isWithinQuietHours(new Date("2026-06-15T15:00:00"), "13:00", "14:00")).toBe(false);
  });
});

describe("recurringMissedRule", () => {
  it("fires when the last 2+ occurrences of a recurring reminder were missed", () => {
    const recurring = baseReminder({
      recurrence: {
        id: "rr1",
        reminder_id: "r1",
        frequency: "daily",
        interval: 1,
      },
    });
    const ctx = emptyContext({
      occurrences: [
        occ({ id: "o1", scheduled_for: "2026-06-13T09:00:00", status: "missed", reminder: recurring }),
        occ({ id: "o2", scheduled_for: "2026-06-14T09:00:00", status: "missed", reminder: recurring }),
      ],
    });
    expect(recurringMissedRule.evaluate(ctx)).toHaveLength(1);
  });

  it("does not fire for a non-recurring reminder", () => {
    const ctx = emptyContext({
      occurrences: [occ({ status: "missed" }), occ({ id: "o2", status: "missed" })],
    });
    expect(recurringMissedRule.evaluate(ctx)).toHaveLength(0);
  });

  it("does not fire when a recent occurrence was acknowledged", () => {
    const recurring = baseReminder({
      recurrence: { id: "rr1", reminder_id: "r1", frequency: "daily", interval: 1 },
    });
    const ctx = emptyContext({
      occurrences: [
        occ({ id: "o1", scheduled_for: "2026-06-13T09:00:00", status: "missed", reminder: recurring }),
        occ({ id: "o2", scheduled_for: "2026-06-14T09:00:00", status: "acknowledged", reminder: recurring }),
      ],
    });
    expect(recurringMissedRule.evaluate(ctx)).toHaveLength(0);
  });
});
