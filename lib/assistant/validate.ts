// V7 — validation layer.
//
// Takes a parser ParseResult plus the caller's real, existing preferences
// (never invented) and returns either the same clarification/unsupported
// result unchanged, or an intent ready to resolve+execute — filling in only
// defaults the EXISTING system already defines (e.g. user_preferences'
// default_reminder_time), never anything the parser didn't ask for.

import type { UserPreferences } from "@/types/reminder";
import type { ParseResult } from "./intents";

export function validate(result: ParseResult, preferences: Pick<UserPreferences, "default_reminder_time">): ParseResult {
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
      // Existing V1 personalization precedent: default_reminder_time is a
      // real, user-configured value — safe to apply when no time was given.
      intent.when.time = preferences.default_reminder_time;
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
      intent.newWhen.time = preferences.default_reminder_time;
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
