import { describe, it, expect } from "vitest";
import { parse } from "@/lib/assistant/parser";
import { extractDateTime, extractRecurrence, toISODate } from "@/lib/assistant/dateParsing";

const NOW = new Date("2026-09-18T12:00:00"); // a Friday

describe("assistant parser — CREATE_REMINDER", () => {
  it("parses a plain create with date + time", () => {
    const r = parse("remind me to call the dentist tomorrow at 10am", NOW);
    expect(r.kind).toBe("INTENT");
    if (r.kind !== "INTENT") return;
    expect(r.intent.type).toBe("CREATE_REMINDER");
    if (r.intent.type !== "CREATE_REMINDER") return;
    expect(r.intent.title.toLowerCase()).toContain("call the dentist");
    expect(r.intent.when.date).toBe("2026-09-19");
    expect(r.intent.when.time).toBe("10:00");
    expect(r.intent.reminderTypes).toContain("call");
  });

  it("parses today/tonight", () => {
    const r = parse("remind me to take out the trash tonight", NOW);
    expect(r.kind).toBe("INTENT");
    if (r.kind !== "INTENT" || r.intent.type !== "CREATE_REMINDER") throw new Error("wrong shape");
    expect(r.intent.when.date).toBe("2026-09-18");
    expect(r.intent.when.time).toBe("20:00");
  });

  it("parses a specific weekday", () => {
    const r = parse("remind me to submit the report on Monday", NOW);
    expect(r.kind).toBe("INTENT");
    if (r.kind !== "INTENT" || r.intent.type !== "CREATE_REMINDER") throw new Error("wrong shape");
    expect(r.intent.when.date).toBe("2026-09-21"); // next Monday after 2026-09-18 (Fri)
  });

  it("parses relative durations: in 2 hours", () => {
    const r = parse("remind me to check the oven in 2 hours", NOW);
    expect(r.kind).toBe("INTENT");
    if (r.kind !== "INTENT" || r.intent.type !== "CREATE_REMINDER") throw new Error("wrong shape");
    expect(r.intent.when.date).toBe("2026-09-18");
    expect(r.intent.when.time).toBe("14:00");
  });

  it("parses relative durations: in 30 minutes", () => {
    const r = parse("remind me to flip the laundry in 30 minutes", NOW);
    expect(r.kind).toBe("INTENT");
    if (r.kind !== "INTENT" || r.intent.type !== "CREATE_REMINDER") throw new Error("wrong shape");
    expect(r.intent.when.time).toBe("12:30");
  });

  it("asks for clarification when title is missing", () => {
    const r = parse("remind me to tomorrow at 9am", NOW);
    expect(r.kind).toBe("NEEDS_CLARIFICATION");
  });

  it("asks for clarification when no date/time can be found", () => {
    const r = parse("remind me to water the plants", NOW);
    expect(r.kind).toBe("NEEDS_CLARIFICATION");
    if (r.kind === "NEEDS_CLARIFICATION") {
      expect(r.question.toLowerCase()).toContain("when");
    }
  });
});

describe("assistant parser — recurrence", () => {
  it("maps 'every Monday' onto the existing weekly+by_weekday shape", () => {
    const r = parse("remind me to take out recycling every Monday at 8am", NOW);
    expect(r.kind).toBe("INTENT");
    if (r.kind !== "INTENT" || r.intent.type !== "CREATE_RECURRING_REMINDER") throw new Error("wrong shape");
    expect(r.intent.recurrence).toEqual({ frequency: "weekly", interval: 1, by_weekday: [1] });
  });

  it("maps 'every weekday'", () => {
    const r = parse("remind me to check email every weekday at 9am", NOW);
    expect(r.kind).toBe("INTENT");
    if (r.kind !== "INTENT" || r.intent.type !== "CREATE_RECURRING_REMINDER") throw new Error("wrong shape");
    expect(r.intent.recurrence).toEqual({ frequency: "weekly", interval: 1, by_weekday: [1, 2, 3, 4, 5] });
  });

  it("maps 'every month'", () => {
    const r = parse("remind me to pay rent every month on the 1st", NOW);
    expect(r.kind).toBe("INTENT");
    if (r.kind !== "INTENT" || r.intent.type !== "CREATE_RECURRING_REMINDER") throw new Error("wrong shape");
    expect(r.intent.recurrence.frequency).toBe("monthly");
  });

  it("asks for clarification on unsafe/ambiguous recurrence phrasing", () => {
    const r = parse("remind me to water plants every full moon", NOW);
    expect(r.kind).toBe("NEEDS_CLARIFICATION");
  });
});

describe("assistant parser — mutations on existing reminders/payments", () => {
  it("parses snooze with a duration", () => {
    const r = parse("snooze the dentist call for 30 minutes", NOW);
    expect(r.kind).toBe("INTENT");
    if (r.kind !== "INTENT" || r.intent.type !== "SNOOZE_REMINDER") throw new Error("wrong shape");
    expect(r.intent.minutes).toBe(30);
    expect(r.intent.reference.text).toContain("dentist call");
  });

  it("parses move/reschedule", () => {
    const r = parse("move the dentist call to tomorrow at 3pm", NOW);
    expect(r.kind).toBe("INTENT");
    if (r.kind !== "INTENT" || r.intent.type !== "UPDATE_REMINDER") throw new Error("wrong shape");
    expect(r.intent.newWhen.date).toBe("2026-09-19");
    expect(r.intent.newWhen.time).toBe("15:00");
  });

  it("asks for clarification when the move target has no recognizable date", () => {
    const r = parse("move the dentist call to sometime", NOW);
    expect(r.kind).toBe("NEEDS_CLARIFICATION");
  });

  it("parses complete", () => {
    const r = parse("mark the dentist call as done", NOW);
    expect(r.kind).toBe("INTENT");
    if (r.kind !== "INTENT" || r.intent.type !== "COMPLETE_REMINDER") throw new Error("wrong shape");
  });

  it("parses mark payment paid", () => {
    const r = parse("mark the Visa card as paid", NOW);
    expect(r.kind).toBe("INTENT");
    if (r.kind !== "INTENT" || r.intent.type !== "MARK_PAYMENT_PAID") throw new Error("wrong shape");
    expect(r.intent.reference.text).toContain("visa card");
  });

  it("parses a pronoun reference", () => {
    const r = parse("snooze it for 15 minutes", NOW);
    expect(r.kind).toBe("INTENT");
    if (r.kind !== "INTENT" || r.intent.type !== "SNOOZE_REMINDER") throw new Error("wrong shape");
    expect(r.intent.reference.isPronoun).toBe(true);
  });
});

describe("assistant parser — queries", () => {
  it("parses QUERY_TODAY", () => {
    const r = parse("what do I need to do today?", NOW);
    expect(r.kind).toBe("INTENT");
    if (r.kind === "INTENT") expect(r.intent.type).toBe("QUERY_TODAY");
  });

  it("parses QUERY_OVERDUE", () => {
    const r = parse("what's overdue?", NOW);
    expect(r.kind).toBe("INTENT");
    if (r.kind === "INTENT") expect(r.intent.type).toBe("QUERY_OVERDUE");
  });

  it("parses QUERY_PAYMENTS", () => {
    const r = parse("what payments do I have coming up?", NOW);
    expect(r.kind).toBe("INTENT");
    if (r.kind === "INTENT") expect(r.intent.type).toBe("QUERY_PAYMENTS");
  });

  it("parses QUERY_UPCOMING", () => {
    const r = parse("what's upcoming?", NOW);
    expect(r.kind).toBe("INTENT");
    if (r.kind === "INTENT") expect(r.intent.type).toBe("QUERY_UPCOMING");
  });
});

describe("assistant parser — unsupported / malformed", () => {
  it("reports unknown free text as unsupported, never guessed", () => {
    const r = parse("what's the meaning of life", NOW);
    expect(r.kind).toBe("UNSUPPORTED");
  });

  it("never returns a raw DELETE-style intent (not in the allowlist)", () => {
    const r = parse("delete the dentist reminder", NOW);
    expect(r.kind).toBe("UNSUPPORTED");
  });
});

describe("date extraction edge cases", () => {
  it("rolls 'tomorrow' over a year boundary correctly", () => {
    const dec31 = new Date("2026-12-31T09:00:00");
    const r = extractDateTime("tomorrow at 9am", dec31);
    expect(r?.when.date).toBe("2027-01-01");
  });

  it("rolls 'tomorrow' over a month boundary correctly", () => {
    const jan31 = new Date("2027-01-31T09:00:00");
    const r = extractDateTime("tomorrow", jan31);
    expect(r?.when.date).toBe("2027-02-01");
  });

  it("handles midnight-adjacent 'tonight'", () => {
    const lateNight = new Date("2026-09-18T23:50:00");
    const r = extractDateTime("tonight", lateNight);
    expect(r?.when.date).toBe(toISODate(lateNight));
    expect(r?.when.time).toBe("20:00");
  });

  it("parses 24-hour time", () => {
    const r = extractDateTime("tomorrow at 14:30", NOW);
    expect(r?.when.time).toBe("14:30");
  });

  it("returns null when there is no recognizable date/time phrase", () => {
    const r = extractDateTime("water the plants", NOW);
    expect(r).toBeNull();
  });

  it("flags unrecognized 'every' phrasing as ambiguous, not silently ignored", () => {
    const r = extractRecurrence("every blue moon");
    expect(r.kind).toBe("AMBIGUOUS");
  });
});
