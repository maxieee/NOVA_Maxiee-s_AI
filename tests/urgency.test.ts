import { describe, it, expect } from "vitest";
import { getUrgency, computeDashboardCounts, getNeedsAttention } from "@/lib/scheduling/urgency";
import type { Reminder } from "@/types/reminder";

function makeReminder(overrides: Partial<Reminder>): Reminder {
  return {
    id: "1",
    user_id: "u1",
    title: "Test",
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
    ...overrides,
  };
}

const NOW = new Date("2026-09-18T12:00:00");

describe("getUrgency", () => {
  it("marks past dates as overdue", () => {
    const r = makeReminder({ date: "2026-09-16" });
    expect(getUrgency(r, NOW)).toBe("overdue");
  });

  it("marks today's date as due_today", () => {
    const r = makeReminder({ date: "2026-09-18" });
    expect(getUrgency(r, NOW)).toBe("due_today");
  });

  it("marks future urgent-priority reminders as urgent", () => {
    const r = makeReminder({ date: "2026-09-20", priority: "urgent" });
    expect(getUrgency(r, NOW)).toBe("urgent");
  });

  it("marks future medium-priority reminders as upcoming", () => {
    const r = makeReminder({ date: "2026-09-25" });
    expect(getUrgency(r, NOW)).toBe("upcoming");
  });

  it("marks completed reminders as completed regardless of date", () => {
    const r = makeReminder({ date: "2026-09-10", status: "completed" });
    expect(getUrgency(r, NOW)).toBe("completed");
  });
});

describe("computeDashboardCounts", () => {
  it("tallies each bucket correctly", () => {
    const reminders = [
      makeReminder({ id: "1", date: "2026-09-16" }), // overdue
      makeReminder({ id: "2", date: "2026-09-18" }), // due today
      makeReminder({ id: "3", date: "2026-09-20", priority: "urgent" }), // urgent
      makeReminder({ id: "4", date: "2026-09-10", status: "completed" }), // completed
      makeReminder({ id: "5", date: "2026-09-25" }), // upcoming, not counted
    ];
    const counts = computeDashboardCounts(reminders, NOW);
    expect(counts).toEqual({ urgent: 1, dueToday: 1, overdue: 1, completed: 1 });
  });
});

describe("getNeedsAttention", () => {
  it("includes overdue, urgent and due-today, sorted by due time", () => {
    const reminders = [
      makeReminder({ id: "a", date: "2026-09-20", priority: "urgent" }),
      makeReminder({ id: "b", date: "2026-09-16" }),
      makeReminder({ id: "c", date: "2026-09-18" }),
      makeReminder({ id: "d", date: "2026-09-25" }),
    ];
    const result = getNeedsAttention(reminders, NOW);
    expect(result.map((r) => r.id)).toEqual(["b", "c", "a"]);
  });
});
