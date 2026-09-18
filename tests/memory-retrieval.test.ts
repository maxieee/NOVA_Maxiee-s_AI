import { describe, it, expect } from "vitest";
import { findDefaultReminderTimeMemory, activeMemoriesByCategory } from "../lib/memory/retrieve";
import { validate } from "../lib/assistant/validate";
import type { PersonalContextEntry } from "../types/reminder";
import type { ParseResult } from "../lib/assistant/intents";

function entry(overrides: Partial<PersonalContextEntry>): PersonalContextEntry {
  return {
    id: "id-1",
    user_id: "user-1",
    category: "reminder_preference",
    label: "preferred reminder time",
    value: "18:00",
    source: "user_entered",
    active: true,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("memory retrieval (pure)", () => {
  it("surfaces a matching reminder-time memory", () => {
    const hint = findDefaultReminderTimeMemory([entry({})]);
    expect(hint?.time).toBe("18:00");
  });

  it("parses common time formats", () => {
    expect(findDefaultReminderTimeMemory([entry({ value: "6pm" })])?.time).toBe("18:00");
    expect(findDefaultReminderTimeMemory([entry({ value: "7:30am" })])?.time).toBe("07:30");
  });

  it("ignores unrelated memories", () => {
    expect(findDefaultReminderTimeMemory([entry({ label: "Allergy", value: "Peanuts", category: "general_fact" })])).toBeNull();
  });

  it("never surfaces a deactivated memory", () => {
    expect(findDefaultReminderTimeMemory([entry({ active: false })])).toBeNull();
  });

  it("filters active memories by category", () => {
    const entries = [entry({ id: "a" }), entry({ id: "b", active: false }), entry({ id: "c", category: "person" })];
    expect(activeMemoriesByCategory(entries, "reminder_preference").map((e) => e.id)).toEqual(["a"]);
  });
});

describe("memory precedence: current instruction > stored memory > nothing", () => {
  const preferences = { default_reminder_time: "09:00" };

  it("an explicit current instruction (5pm) always wins over a memory (prefers mornings)", () => {
    const parsed: ParseResult = {
      kind: "INTENT",
      intent: {
        type: "CREATE_REMINDER",
        title: "Take medicine",
        when: { date: "2026-09-20", time: "17:00" }, // user explicitly said 5pm
        reminderTypes: [],
      },
    };
    const memories = [entry({ label: "preferred reminder time", value: "07:00" })]; // "mornings"

    const result = validate(parsed, preferences, memories);
    expect(result.kind).toBe("INTENT");
    if (result.kind === "INTENT" && result.intent.type === "CREATE_REMINDER") {
      expect(result.intent.when.time).toBe("17:00");
    } else {
      throw new Error("expected CREATE_REMINDER");
    }
  });

  it("falls back to the memory hint only when the user left the time unspecified", () => {
    const parsed: ParseResult = {
      kind: "INTENT",
      intent: {
        type: "CREATE_REMINDER",
        title: "Take medicine",
        when: { date: "2026-09-20", time: null },
        reminderTypes: [],
      },
    };
    const memories = [entry({ label: "preferred reminder time", value: "07:00" })];

    const result = validate(parsed, preferences, memories);
    if (result.kind === "INTENT" && result.intent.type === "CREATE_REMINDER") {
      expect(result.intent.when.time).toBe("07:00");
    } else {
      throw new Error("expected CREATE_REMINDER");
    }
  });

  it("falls back to user_preferences.default_reminder_time when no memory hint exists either", () => {
    const parsed: ParseResult = {
      kind: "INTENT",
      intent: {
        type: "CREATE_REMINDER",
        title: "Take medicine",
        when: { date: "2026-09-20", time: null },
        reminderTypes: [],
      },
    };

    const result = validate(parsed, preferences, []);
    if (result.kind === "INTENT" && result.intent.type === "CREATE_REMINDER") {
      expect(result.intent.when.time).toBe("09:00");
    } else {
      throw new Error("expected CREATE_REMINDER");
    }
  });
});
