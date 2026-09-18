// V7 — deterministic natural-language date/time extraction.
//
// This module only EXTRACTS structured date/time components from text; all
// actual calendar arithmetic is done with the project's existing date
// library (date-fns), never bespoke math, per the V7 brief. Downstream
// code (lib/scheduling/recurrence.ts, paymentDates.ts) owns the rest.

import {
  addDays,
  addHours,
  addMinutes,
  format,
  nextDay,
  setHours,
  setMinutes,
  setSeconds,
  setMilliseconds,
  type Day,
} from "date-fns";
import type { ParsedDateTime, RecurrenceSpec } from "./intents";

const WEEKDAYS: Record<string, Day> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

const NUMBER_WORDS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  fifteen: 15,
  twenty: 20,
  thirty: 30,
  forty: 40,
  forty_five: 45,
  sixty: 60,
};

function wordToNumber(raw: string): number | null {
  const cleaned = raw.trim().toLowerCase().replace(/-/g, " ");
  if (/^\d+(\.\d+)?$/.test(cleaned)) return parseFloat(cleaned);
  if (cleaned === "forty five" || cleaned === "forty-five") return 45;
  if (NUMBER_WORDS[cleaned] != null) return NUMBER_WORDS[cleaned];
  return null;
}

export function toISODate(d: Date): string {
  return format(d, "yyyy-MM-dd");
}

export function toHHmm(d: Date): string {
  return format(d, "HH:mm");
}

/** Sets time-of-day on a date without mutating a shared clock. */
function atTime(base: Date, hour: number, minute: number): Date {
  return setMilliseconds(setSeconds(setMinutes(setHours(base, hour), minute), 0), 0);
}

interface TimeMatch {
  hour: number;
  minute: number;
  raw: string;
}

/** Extracts a clock time like "10am", "6 pm", "14:30", "at 9:15 AM". */
function extractTime(text: string): TimeMatch | null {
  const m = text.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i);
  if (m) {
    let hour = parseInt(m[1], 10);
    const minute = m[2] ? parseInt(m[2], 10) : 0;
    const meridiem = m[3].toLowerCase();
    if (hour === 12) hour = 0;
    if (meridiem === "pm") hour += 12;
    return { hour, minute, raw: m[0] };
  }
  const m24 = text.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
  if (m24) {
    return { hour: parseInt(m24[1], 10), minute: parseInt(m24[2], 10), raw: m24[0] };
  }
  return null;
}

export interface DateTimeExtraction {
  when: ParsedDateTime;
  /** Substrings matched, for stripping out of the reminder title. */
  matchedFragments: string[];
  /** True if the phrase gave a specific time (vs. date only). */
  hasExplicitTime: boolean;
}

/**
 * Extracts a date + optional time from free text. Returns null when no
 * recognizable date/time phrase is present at all (caller decides whether
 * that's an error requiring clarification, e.g. no sensible default).
 */
export function extractDateTime(text: string, now: Date): DateTimeExtraction | null {
  const lower = text.toLowerCase();
  const fragments: string[] = [];
  let day: Date | null = null;
  let hasExplicitTime = false;
  let hour = 9;
  let minute = 0;

  // Relative durations: "in 2 hours", "in 30 minutes", "for two hours".
  const relHours = lower.match(/\b(?:in|for)\s+([a-z0-9\- ]+?)\s*hours?\b/);
  const relMinutes = lower.match(/\b(?:in|for)\s+([a-z0-9\- ]+?)\s*minutes?\b/);
  if (relHours || relMinutes) {
    let result = now;
    if (relHours) {
      const n = wordToNumber(relHours[1]);
      if (n != null) {
        result = addHours(result, n);
        fragments.push(relHours[0]);
      }
    }
    if (relMinutes) {
      const n = wordToNumber(relMinutes[1]);
      if (n != null) {
        result = addMinutes(result, n);
        fragments.push(relMinutes[0]);
      }
    }
    if (fragments.length > 0) {
      return {
        when: { date: toISODate(result), time: toHHmm(result) },
        matchedFragments: fragments,
        hasExplicitTime: true,
      };
    }
  }

  // Named days.
  if (/\btonight\b/.test(lower)) {
    day = now;
    hour = 20;
    fragments.push("tonight");
  } else if (/\btomorrow\b/.test(lower)) {
    day = addDays(now, 1);
    fragments.push("tomorrow");
  } else if (/\btoday\b/.test(lower)) {
    day = now;
    fragments.push("today");
  } else {
    for (const [name, dow] of Object.entries(WEEKDAYS)) {
      const re = new RegExp(`\\b(?:on\\s+)?${name}\\b`, "i");
      if (re.test(lower)) {
        day = nextDay(now, dow);
        fragments.push(name);
        break;
      }
    }
  }

  // Explicit ISO date, e.g. "2026-12-31" or "on 12/31/2026".
  if (!day) {
    const iso = lower.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
    if (iso) {
      day = new Date(`${iso[0]}T00:00:00`);
      fragments.push(iso[0]);
    }
  }

  const timeMatch = extractTime(lower);
  if (timeMatch) {
    hour = timeMatch.hour;
    minute = timeMatch.minute;
    hasExplicitTime = true;
    fragments.push(timeMatch.raw);
  } else if (/\bmorning\b/.test(lower)) {
    hour = 9;
    fragments.push("morning");
  } else if (/\bafternoon\b/.test(lower)) {
    hour = 15;
    fragments.push("afternoon");
  } else if (/\bevening\b/.test(lower)) {
    hour = 18;
    fragments.push("evening");
  }

  if (!day) {
    if (fragments.length === 0) return null;
    day = now;
  }

  const result = atTime(day, hour, minute);
  return {
    when: { date: toISODate(result), time: hasExplicitTime || fragments.includes("morning") || fragments.includes("afternoon") || fragments.includes("evening") || fragments.includes("tonight") ? toHHmm(result) : null },
    matchedFragments: fragments,
    hasExplicitTime,
  };
}

export type RecurrenceParse =
  | { kind: "RECURRENCE"; recurrence: RecurrenceSpec }
  | { kind: "AMBIGUOUS"; phrase: string }
  | { kind: "NONE" };

/**
 * Recognizes a small, safe set of recurrence phrases and maps them onto the
 * EXISTING recurrence_rules shape (see lib/scheduling/recurrence.ts's
 * RecurrenceRule contract). Anything not on this list is reported as
 * ambiguous so the caller asks for clarification rather than guessing.
 */
export function extractRecurrence(text: string): RecurrenceParse {
  const lower = text.toLowerCase();
  if (!/\bevery\b/.test(lower)) return { kind: "NONE" };

  if (/\bevery\s+weekday\b/.test(lower)) {
    return { kind: "RECURRENCE", recurrence: { frequency: "weekly", interval: 1, by_weekday: [1, 2, 3, 4, 5] } };
  }
  if (/\bevery\s+day\b/.test(lower)) {
    return { kind: "RECURRENCE", recurrence: { frequency: "daily", interval: 1 } };
  }
  if (/\bevery\s+month\b/.test(lower)) {
    return { kind: "RECURRENCE", recurrence: { frequency: "monthly", interval: 1 } };
  }
  if (/\bevery\s+year\b/.test(lower)) {
    return { kind: "RECURRENCE", recurrence: { frequency: "monthly", interval: 12 } };
  }
  for (const [name, dow] of Object.entries(WEEKDAYS)) {
    if (new RegExp(`\\bevery\\s+${name}\\b`, "i").test(lower)) {
      return { kind: "RECURRENCE", recurrence: { frequency: "weekly", interval: 1, by_weekday: [dow] } };
    }
  }

  // "every N days/weeks" — safe numeric interval.
  const everyN = lower.match(/\bevery\s+(\d+)\s+(day|week|month)s?\b/);
  if (everyN) {
    const n = parseInt(everyN[1], 10);
    const unit = everyN[2];
    if (unit === "day") return { kind: "RECURRENCE", recurrence: { frequency: "daily", interval: n } };
    if (unit === "week") return { kind: "RECURRENCE", recurrence: { frequency: "weekly", interval: n } };
    return { kind: "RECURRENCE", recurrence: { frequency: "monthly", interval: n } };
  }

  const m = lower.match(/\bevery\s+[a-z0-9 ]+/);
  return { kind: "AMBIGUOUS", phrase: m ? m[0] : "every ..." };
}

export function extractMinutesDuration(text: string): number | null {
  const lower = text.toLowerCase();
  const m = lower.match(/\b(\d+)\s*(?:minutes?|mins?)\b/);
  if (m) return parseInt(m[1], 10);
  const h = lower.match(/\b(\d+)\s*(?:hours?|hrs?)\b/);
  if (h) return parseInt(h[1], 10) * 60;
  const words = lower.match(/\b(one|two|three|four|five|ten|fifteen|twenty|thirty|forty[- ]?five|sixty)\s*(?:minutes?|mins?)\b/);
  if (words) {
    const n = wordToNumber(words[1]);
    if (n != null) return n;
  }
  return null;
}
