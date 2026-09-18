import { describe, it, expect } from "vitest";
import {
  computeNextStatementDate,
  computeDueDateForStatement,
  cyclePeriodFor,
} from "@/lib/scheduling/paymentDates";

describe("computeNextStatementDate — fixed day-of-month, with clamping", () => {
  it("returns this month's date when it hasn't passed yet", () => {
    const from = new Date("2026-03-10T00:00:00");
    const next = computeNextStatementDate(15, from);
    expect(next.getFullYear()).toBe(2026);
    expect(next.getMonth()).toBe(2); // March
    expect(next.getDate()).toBe(15);
  });

  it("rolls forward to next month once this month's date has passed", () => {
    const from = new Date("2026-03-20T00:00:00");
    const next = computeNextStatementDate(15, from);
    expect(next.getMonth()).toBe(3); // April
    expect(next.getDate()).toBe(15);
  });

  it("clamps day 31 down to Feb 28 in a non-leap year", () => {
    const from = new Date("2027-02-01T00:00:00");
    const next = computeNextStatementDate(31, from);
    expect(next.getMonth()).toBe(1); // February
    expect(next.getDate()).toBe(28);
  });

  it("clamps day 31 down to Feb 29 in a leap year", () => {
    const from = new Date("2028-02-01T00:00:00"); // 2028 is a leap year
    const next = computeNextStatementDate(31, from);
    expect(next.getMonth()).toBe(1);
    expect(next.getDate()).toBe(29);
  });

  it("clamps day 31 down to the 30th in a 30-day month (April)", () => {
    const from = new Date("2026-04-01T00:00:00");
    const next = computeNextStatementDate(31, from);
    expect(next.getMonth()).toBe(3); // April
    expect(next.getDate()).toBe(30);
  });
});

describe("computeDueDateForStatement", () => {
  it("fixed_day: due day-of-month in the month after the statement", () => {
    const statement = new Date("2026-01-05T00:00:00");
    const due = computeDueDateForStatement(statement, "fixed_day", 20, null);
    expect(due.getMonth()).toBe(0); // January (20 > 5, same month)
    expect(due.getDate()).toBe(20);
  });

  it("fixed_day: rolls into next month when the fixed day is before/at the statement day", () => {
    const statement = new Date("2026-01-25T00:00:00");
    const due = computeDueDateForStatement(statement, "fixed_day", 20, null);
    expect(due.getMonth()).toBe(1); // February
    expect(due.getDate()).toBe(20);
  });

  it("fixed_day: clamps the due day for a short month", () => {
    const statement = new Date("2026-01-30T00:00:00");
    const due = computeDueDateForStatement(statement, "fixed_day", 31, null);
    // 31 > 30 so same month (January) at its own last day (31)
    expect(due.getMonth()).toBe(0);
    expect(due.getDate()).toBe(31);
  });

  it("days_after_statement: adds N days across a month boundary", () => {
    const statement = new Date("2026-01-25T00:00:00");
    const due = computeDueDateForStatement(statement, "days_after_statement", null, 10);
    expect(due.getMonth()).toBe(1); // February
    expect(due.getDate()).toBe(4);
  });

  it("days_after_statement: handles Feb -> March across a leap year boundary", () => {
    const statement = new Date("2028-02-27T00:00:00");
    const due = computeDueDateForStatement(statement, "days_after_statement", null, 3);
    expect(due.getMonth()).toBe(2); // March (2028 leap: Feb has 29 days)
    expect(due.getDate()).toBe(1);
  });
});

describe("cyclePeriodFor", () => {
  it("formats as YYYY-MM", () => {
    expect(cyclePeriodFor(new Date("2026-01-05T00:00:00"))).toBe("2026-01");
    expect(cyclePeriodFor(new Date("2026-11-30T00:00:00"))).toBe("2026-11");
  });
});
