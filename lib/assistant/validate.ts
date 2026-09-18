// V7 — validation layer.
//
// Takes a parser ParseResult plus the caller's real, existing preferences
// (never invented) and returns either the same clarification/unsupported
// result unchanged, or an intent ready to resolve+execute — filling in only
// defaults the EXISTING system already defines (e.g. user_preferences'
// default_reminder_time), never anything the parser didn't ask for.

import type { PersonalContextEntry, UserPreferences } from "@/types/reminder";
import type { ParseResult } from "./intents";
import { findDefaultReminderTimeMemory } from "@/lib/memory/retrieve";

/**
 * Fills a still-missing reminder time. Called only after the parser has
 * already had its chance to read an explicit time off the current
 * instruction (see the `!intent.when.time` guards below) — this function
 * never runs, and therefore never wins, when the user specified a time.
 *
 * Precedence for the fallback itself: a long-term memory hint (V9,
 * step 3) is tried first because it is more specific to the user than the
 * blanket structured default, then user_preferences.default_reminder_time
 * (V1, step 2) as the last resort before falling through to whatever the
 * parser already had. Both are real, existing user-provided values —
 * nothing here is invented.
 */
function fallbackReminderTime(
  preferences: Pick<UserPreferences, "default_reminder_time">,
  memories: PersonalContextEntry[]
): string {
  const memoryHint = findDefaultReminderTimeMemory(memories);
  return memoryHint?.time ?? preferences.default_reminder_time;
}

export function validate(
  result: ParseResult,
  preferences: Pick<UserPreferences, "default_reminder_time">,
  memories: PersonalContextEntry[] = []
): ParseResult {
  if (result.kind !== "INTENT") return result;
  const intent = result.intent;

  if (intent.type === "CREATE_REMINDER" || intent.type === "CREATE_RECURRING_REMINDER") {
    if (!intent.title || intent.title.trim().length === 0) {
      return {
        kind: "NEEDS_CLARIFICATION",
        question: "I can do that — what should I remind you about?",
        partialType: intent.type,
      };
    }
    if (!intent.when.date) {
      return {
        kind: "NEEDS_CLARIFICATION",
        question: `When should I remind you about "${intent.title}"?`,
        partialType: intent.type,
      };
    }
    if (!intent.when.time) {
      // Current instruction had no time — fall back to a stored default.
      // Existing V1 personalization precedent: default_reminder_time is a
      // real, user-configured value — safe to apply when no time was given.
      intent.when.time = fallbackReminderTime(preferences, memories);
    }
    return { kind: "INTENT", intent };
  }

  if (intent.type === "UPDATE_REMINDER") {
    if (!intent.reference.text && !intent.reference.isPronoun) {
      return {
        kind: "NEEDS_CLARIFICATION",
        question: "Which reminder should I move?",
        partialType: "UPDATE_REMINDER",
      };
    }
    if (!intent.newWhen.time) {
      intent.newWhen.time = fallbackReminderTime(preferences, memories);
    }
    return { kind: "INTENT", intent };
  }

  if (
    intent.type === "SNOOZE_REMINDER" ||
    intent.type === "COMPLETE_REMINDER" ||
    intent.type === "REMIND_AGAIN" ||
    intent.type === "MARK_PAYMENT_PAID"
  ) {
    if (!intent.reference.text && !intent.reference.isPronoun) {
      return {
        kind: "NEEDS_CLARIFICATION",
        question: "Which one did you mean?",
        partialType: intent.type,
      };
    }
  }

  return result;
}
