import { describe, it, expect } from "vitest";
import { computeNextOccurrence, computeLeadTimeSchedule, computeNextRepeat } from "@/lib/scheduling/recurrence";

describe("computeNextOccurrence", () => {
  it("advances daily by interval", () => {
    const next = computeNextOccurrence(
      { frequency: "daily", interval: 3, by_weekday: null, by_day_of_month: null, ends_at: null, occurrences_limit: null },
      new Date("2026-09-18")
    );
    expect(next?.toISOString().slice(0, 10)).toBe("2026-09-21");
  });

  it("advances monthly and clamps day-of-month to the shorter month", () => {
    const next = computeNextOccurrence(
      { frequency: "monthly", interval: 1, by_weekday: null, by_day_of_month: 31, ends_at: null, occurrences_limit: null },
      new Date("2026-01-31")
    );
    // February 2026 has 28 days
    expect(next?.getMonth()).toBe(1);
    expect(next?.getDate()).toBe(28);
  });

  it("returns null once occurrences_limit is reached", () => {
    const next = computeNextOccurrence(
      { frequency: "weekly", interval: 1, by_weekday: null, by_day_of_month: null, ends_at: null, occurrences_limit: 2 },
      new Date("2026-09-18"),
      2
    );
    expect(next).toBeNull();
  });

  it("returns null once past the end date", () => {
    const next = computeNextOccurrence(
      { frequency: "yearly", interval: 1, by_weekday: null, by_day_of_month: null, ends_at: "2026-10-01", occurrences_limit: null },
      new Date("2026-09-18")
    );
    expect(next).toBeNull();
  });
});

describe("computeLeadTimeSchedule", () => {
  it("produces one date per lead time plus the due-date morning, sorted", () => {
    const due = new Date("2026-09-30T00:00:00");
    const dates = computeLeadTimeSchedule(due, [7, 3, 1]);
    expect(dates).toHaveLength(4);
    expect(dates[0].getDate()).toBe(23);
    expect(dates[dates.length - 1].getDate()).toBe(30);
  });
});

describe("computeNextRepeat", () => {
  it("increments repeat count and escalates after the threshold", () => {
    const state = { repeatCount: 0, escalated: false };
    const last = new Date("2026-09-18T09:00:00");

    const r1 = computeNextRepeat(last, state, 120, true, 3);
    expect(r1.state.repeatCount).toBe(1);
    expect(r1.state.escalated).toBe(false);

    const r2 = computeNextRepeat(r1.nextFireAt, r1.state, 120, true, 3);
    const r3 = computeNextRepeat(r2.nextFireAt, r2.state, 120, true, 3);
    expect(r3.state.repeatCount).toBe(3);
    expect(r3.state.escalated).toBe(true);
  });

  it("never escalates when escalation is disabled", () => {
    let state = { repeatCount: 0, escalated: false };
    const last = new Date("2026-09-18T09:00:00");
    for (let i = 0; i < 5; i++) {
      const r = computeNextRepeat(last, state, 60, false, 3);
      state = r.state;
    }
    expect(state.escalated).toBe(false);
  });
});
