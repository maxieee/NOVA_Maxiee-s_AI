// V9 — long-term memory retrieval.
//
// This is a HINT layer, not an override. It takes already-loaded active
// "What NOVA Knows" entries and looks for one relevant to the current,
// already-parsed intent — mirroring exactly how lib/assistant/validate.ts
// already applies user_preferences.default_reminder_time: only when the
// current instruction left a value unspecified. Retrieval must never run
// before parsing, and it must never overwrite a value the parser already
// extracted from what the user just said.
//
// Precedence (enforced by call order, not by this function alone):
//   1. current instruction (parser output)      <- always wins if present
//   2. stored structured preference (user_preferences)
//   3. long-term memory (personal_context_entries), via this module
//   4. nothing (falls through to a clarification question)
//
// validate.ts already implements steps 1-2. This module implements step 3
// and is consulted strictly after 1-2 have had their chance, and only for
// the field(s) still missing.

import type { PersonalContextEntry } from "@/types/reminder";

export interface ReminderTimeHint {
  time: string; // HH:mm
  source: PersonalContextEntry;
}

/**
 * Looks for a "reminder_preference" (or legacy "general"/"preference")
 * memory entry that names a default reminder time, e.g. label "default
 * reminder time" / "preferred reminder time", value "18:00" or "6pm".
 * Returns null when nothing usable is stored — callers must not invent one.
 */
export function findDefaultReminderTimeMemory(
  entries: PersonalContextEntry[]
): ReminderTimeHint | null {
  const candidates = entries.filter(
    (e) => e.active && (e.category === "reminder_preference" || e.category === "preference")
  );
  for (const entry of candidates) {
    const label = entry.label.toLowerCase();
    if (!label.includes("reminder") || !label.includes("time")) continue;
    const time = parseTimeValue(entry.value);
    if (time) return { time, source: entry };
  }
  return null;
}

function parseTimeValue(value: string): string | null {
  const hhmm = value.match(/^(\d{1,2}):(\d{2})$/);
  if (hhmm) {
    const h = Number(hhmm[1]);
    const m = Number(hhmm[2]);
    if (h >= 0 && h < 24 && m >= 0 && m < 60) {
      return `${String(h).padStart(2, "0")}:${hhmm[2]}`;
    }
  }
  const ampm = value.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/i);
  if (ampm) {
    let h = Number(ampm[1]) % 12;
    if (/pm/i.test(ampm[3])) h += 12;
    const m = ampm[2] ?? "00";
    return `${String(h).padStart(2, "0")}:${m}`;
  }
  return null;
}

/**
 * Generic lookup used by any future field: returns active memories in a
 * given category, most recent first. Never surfaces inactive/deactivated
 * entries — deactivating a memory in the UI removes it from retrieval
 * immediately without deleting its history.
 */
export function activeMemoriesByCategory(
  entries: PersonalContextEntry[],
  category: string
): PersonalContextEntry[] {
  return entries.filter((e) => e.active && e.category === category);
}
