// V7 — deterministic entity resolution.
//
// Resolves a parsed EntityReference against EXISTING data only (via the
// existing DataLayer's list methods — never a new parallel store), in this
// fixed order: exact name -> normalized/case-insensitive partial match ->
// unique partial match -> conversation context -> clarification. Multiple
// matches are NEVER picked among randomly; ambiguity always produces a
// clarification/confirmation request instead.

import type { Reminder, PaymentAccount } from "@/types/reminder";
import type { EntityReference } from "./intents";
import type { SessionContext } from "./context";

export type ResolveResult<T> =
  | { kind: "RESOLVED"; item: T }
  | { kind: "AMBIGUOUS"; matches: T[] }
  | { kind: "NOT_FOUND" };

function normalize(s: string): string {
  return s.trim().toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ");
}

const STOPWORDS = new Set(["the", "a", "an", "my", "about", "on", "call", "reminder", "for", "of"]);

function significantTokens(s: string): string[] {
  return normalize(s)
    .split(" ")
    .filter((w) => w.length > 0 && !STOPWORDS.has(w));
}

/**
 * Word-order-independent partial match: every significant word in the
 * reference must appear somewhere in the candidate's title/name (or vice
 * versa for a very short candidate name). Deterministic — never a fuzzy
 * edit-distance guess — so "the accountant call" still matches a reminder
 * titled "Call the accountant".
 */
function tokensMatch(needle: string, candidate: string): boolean {
  const needleTokens = significantTokens(needle);
  const candidateTokens = new Set(significantTokens(candidate));
  if (needleTokens.length === 0 || candidateTokens.size === 0) return false;
  return needleTokens.every((t) => candidateTokens.has(t));
}

function activeReminders(reminders: Reminder[]): Reminder[] {
  return reminders.filter((r) => r.status !== "completed" && r.status !== "cancelled");
}

export function resolveReminder(
  reference: EntityReference,
  reminders: Reminder[],
  context: SessionContext
): ResolveResult<Reminder> {
  const candidates = activeReminders(reminders);

  if (reference.isPronoun) {
    if (context.lastReminderId) {
      const item = reminders.find((r) => r.id === context.lastReminderId);
      if (item) return { kind: "RESOLVED", item };
    }
    return { kind: "NOT_FOUND" };
  }

  const needle = normalize(reference.text);
  if (!needle) {
    if (context.lastReminderId) {
      const item = reminders.find((r) => r.id === context.lastReminderId);
      if (item) return { kind: "RESOLVED", item };
    }
    return { kind: "NOT_FOUND" };
  }

  // Exact name match.
  const exact = candidates.filter((r) => normalize(r.title) === needle);
  if (exact.length === 1) return { kind: "RESOLVED", item: exact[0] };
  if (exact.length > 1) return disambiguateByDate(exact, reference);

  // Unique partial match: order-independent token containment.
  const partial = candidates.filter((r) => tokensMatch(reference.text, r.title));
  if (partial.length === 1) return { kind: "RESOLVED", item: partial[0] };
  if (partial.length > 1) return disambiguateByDate(partial, reference);

  // Fall back to conversation context (e.g. "the one tomorrow" after a create).
  if (context.lastReminderId) {
    const item = reminders.find((r) => r.id === context.lastReminderId);
    if (item && tokensMatch(reference.text, item.title)) return { kind: "RESOLVED", item };
  }

  return { kind: "NOT_FOUND" };
}

function disambiguateByDate(matches: Reminder[], reference: EntityReference): ResolveResult<Reminder> {
  if (reference.dateHint) {
    const byHint = matches.filter((r) => dateMatchesHint(r.date, reference.dateHint!));
    if (byHint.length === 1) return { kind: "RESOLVED", item: byHint[0] };
  }
  return { kind: "AMBIGUOUS", matches };
}

function dateMatchesHint(dateISO: string, hint: string): boolean {
  const today = new Date();
  const target = new Date(`${dateISO}T00:00:00`);
  const daysDiff = Math.round((target.getTime() - new Date(today.toDateString()).getTime()) / 86_400_000);
  if (hint === "today" || hint === "tonight") return daysDiff === 0;
  if (hint === "tomorrow") return daysDiff === 1;
  return false;
}

export function resolvePaymentAccount(
  reference: EntityReference,
  accounts: PaymentAccount[],
  context: SessionContext
): ResolveResult<PaymentAccount> {
  const active = accounts.filter((a) => a.active);

  if (reference.isPronoun) {
    if (context.lastPaymentAccountId) {
      const item = accounts.find((a) => a.id === context.lastPaymentAccountId);
      if (item) return { kind: "RESOLVED", item };
    }
    return { kind: "NOT_FOUND" };
  }

  const needle = normalize(reference.text);
  if (!needle) {
    if (context.lastPaymentAccountId) {
      const item = accounts.find((a) => a.id === context.lastPaymentAccountId);
      if (item) return { kind: "RESOLVED", item };
    }
    return { kind: "NOT_FOUND" };
  }

  const exact = active.filter((a) => normalize(a.name) === needle);
  if (exact.length === 1) return { kind: "RESOLVED", item: exact[0] };
  if (exact.length > 1) return { kind: "AMBIGUOUS", matches: exact };

  const partial = active.filter((a) => tokensMatch(reference.text, a.name));
  if (partial.length === 1) return { kind: "RESOLVED", item: partial[0] };
  if (partial.length > 1) return { kind: "AMBIGUOUS", matches: partial };

  if (context.lastPaymentAccountId) {
    const item = accounts.find((a) => a.id === context.lastPaymentAccountId);
    if (item && tokensMatch(reference.text, item.name)) return { kind: "RESOLVED", item };
  }

  return { kind: "NOT_FOUND" };
}
