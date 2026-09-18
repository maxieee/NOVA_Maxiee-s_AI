// V7 — pure, deterministic natural-language parser.
//
// Given input text + "now" + minimal conversation context, returns a
// ParseResult: a candidate intent (still subject to lib/assistant/validate.ts
// before execution), a clarification request, or "unsupported". No DB / IO
// here — fully unit-testable, and it NEVER does its own date math beyond
// extracting structured components (see dateParsing.ts), matching the V7
// brief's "parser hands components to existing utilities" rule.

import type { ReminderTypeKey } from "@/types/reminder";
import type { AssistantIntent, EntityReference, ParseResult } from "./intents";
import { extractDateTime, extractRecurrence, extractMinutesDuration, toISODate } from "./dateParsing";

function toISODateFallback(now: Date): string {
  return toISODate(now);
}

export interface ParserContext {
  /** Text of the last 1-2 turns, most recent last — used only for pronoun resolution hints. */
  recentTurns?: string[];
}

const TYPE_KEYWORDS: Array<{ re: RegExp; type: ReminderTypeKey }> = [
  { re: /\bcall\b/i, type: "call" },
  { re: /\bmeeting\b/i, type: "meeting" },
  { re: /\bpay(ment)?\b|\bbill\b/i, type: "payment" },
  { re: /\bfollow[- ]?up\b/i, type: "follow_up" },
  { re: /\bbirthday|anniversary\b/i, type: "important_date" },
  { re: /\btask\b|\bto[- ]?do\b/i, type: "task" },
];

function detectReminderTypes(text: string): ReminderTypeKey[] {
  const found: ReminderTypeKey[] = [];
  for (const { re, type } of TYPE_KEYWORDS) {
    if (re.test(text)) found.push(type);
  }
  return found.length > 0 ? found : ["general"];
}

/** Strips date/time/recurrence fragments and boilerplate verbs out of a raw phrase to recover the title. */
function cleanTitle(raw: string, fragments: string[]): string {
  let title = raw;
  for (const frag of fragments) {
    title = title.replace(new RegExp(escapeRegExp(frag), "i"), "");
  }
  title = title
    .replace(/\bevery\s+[a-z0-9 ]+$/i, "")
    .replace(/\b(at|on|by|for|in)\s*$/i, "")
    .replace(/\s{2,}/g, " ")
    .trim()
    .replace(/^[,.\s]+|[,.\s]+$/g, "");
  return title;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractReference(text: string): EntityReference {
  const pronounMatch = /\b(it|that|this one)\b/i.test(text);
  // Trailing date hint like "the one tomorrow".
  const dateHintMatch = text.match(/\b(tomorrow|today|tonight)\b/i);
  const cleaned = text
    .replace(/\b(it|that|this one)\b/gi, "")
    .replace(/\bthe\s+(one\s+)?/gi, "")
    .replace(/\b(tomorrow|today|tonight)\b/gi, "")
    .trim();
  return {
    text: cleaned,
    dateHint: dateHintMatch ? dateHintMatch[1].toLowerCase() : undefined,
    isPronoun: pronounMatch && cleaned.length === 0,
  };
}

export function parse(input: string, now: Date, context: ParserContext = {}): ParseResult {
  void context; // reserved for future pronoun-hint use; resolution itself lives in resolveEntity.ts
  const text = input.trim();
  if (!text) {
    return { kind: "NEEDS_CLARIFICATION", question: "I didn't catch that — what would you like me to do?" };
  }
  const lower = text.toLowerCase();

  // --- Query intents -------------------------------------------------
  if (/\bwhat'?s?\s+overdue\b|\boverdue\b.*\?/.test(lower) || /^what'?s?\s+overdue/.test(lower)) {
    return { kind: "INTENT", intent: { type: "QUERY_OVERDUE" } };
  }
  if (/\bwhat\s+payments\b|\bpayments\s+(are\s+)?due\b|\bwhat\s+do\s+i\s+owe\b/.test(lower)) {
    return { kind: "INTENT", intent: { type: "QUERY_PAYMENTS" } };
  }
  if (/\bwhat'?s?\s+upcoming\b|\bwhat'?s?\s+coming\s+up\b/.test(lower)) {
    return { kind: "INTENT", intent: { type: "QUERY_UPCOMING" } };
  }
  if (
    /\bwhat\s+do\s+i\s+need\s+to\s+do\b/.test(lower) ||
    /\bwhat'?s?\s+(going\s+on\s+)?today\b/.test(lower) ||
    /\bwhat'?s?\s+on\s+my\s+plate\b/.test(lower)
  ) {
    return { kind: "INTENT", intent: { type: "QUERY_TODAY" } };
  }

  // A "remind me to ..." phrase always takes the create path below, even if
  // its body happens to contain a word like "pay" — checked once, up front.
  const isCreatePhrase = /\bremind\s+me\s+to\b/.test(lower);

  // --- Mark payment paid ----------------------------------------------
  const paidMatch =
    !isCreatePhrase &&
    (lower.match(/\bmark\s+(.+?)\s+(?:as\s+)?paid\b/) || lower.match(/\bpay\s+(?:off\s+)?(.+)/));
  if (paidMatch) {
    const refText = paidMatch[1];
    return {
      kind: "INTENT",
      intent: { type: "MARK_PAYMENT_PAID", reference: extractReference(refText) },
    };
  }

  // --- Snooze -----------------------------------------------------------
  const snoozeMatch = !isCreatePhrase && lower.match(/\bsnooze\s+(.+)/);
  if (snoozeMatch) {
    const rest = snoozeMatch[1];
    const minutes = extractMinutesDuration(rest) ?? 15;
    const refText = rest
      .replace(/\bfor\s+.*/i, "")
      .replace(/\bby\s+.*/i, "")
      .trim();
    return {
      kind: "INTENT",
      intent: { type: "SNOOZE_REMINDER", reference: extractReference(refText), minutes },
    };
  }

  // --- Move / reschedule (update) ---------------------------------------
  const moveMatch = !isCreatePhrase && lower.match(/\b(?:move|reschedule|push)\s+(.+?)\s+to\s+(.+)/);
  if (moveMatch) {
    const refText = moveMatch[1];
    const whenText = moveMatch[2];
    const dt = extractDateTime(whenText, now);
    if (!dt) {
      return {
        kind: "NEEDS_CLARIFICATION",
        question: `When should I move that to? I couldn't work out a date or time from "${whenText}".`,
        partialType: "UPDATE_REMINDER",
      };
    }
    return {
      kind: "INTENT",
      intent: { type: "UPDATE_REMINDER", reference: extractReference(refText), newWhen: dt.when },
    };
  }

  // --- Complete -----------------------------------------------------------
  const doneMatch =
    !isCreatePhrase &&
    (lower.match(/\bmark\s+(.+?)\s+(?:as\s+)?done\b/) ||
      lower.match(/\bcomplete\s+(.+)/) ||
      lower.match(/\bi'?m\s+done\s+with\s+(.+)/) ||
      lower.match(/\bfinished\s+(.+)/));
  if (doneMatch) {
    return {
      kind: "INTENT",
      intent: { type: "COMPLETE_REMINDER", reference: extractReference(doneMatch[1]) },
    };
  }

  // --- Remind again (re-notify) -------------------------------------------
  const againMatch = lower.match(/\bremind\s+me\s+again\s+(?:about|of)\s+(.+)/);
  if (againMatch) {
    return {
      kind: "INTENT",
      intent: { type: "REMIND_AGAIN", reference: extractReference(againMatch[1]) },
    };
  }

  // --- Create reminder ------------------------------------------------
  const createMatch = text.match(/remind\s+me\s+to\s+(.+)/i);
  if (createMatch) {
    const body = createMatch[1];
    const recurrence = extractRecurrence(body);
    if (recurrence.kind === "AMBIGUOUS") {
      return {
        kind: "NEEDS_CLARIFICATION",
        question: `I'm not sure how to repeat that — could you say it like "every Monday", "every weekday" or "every month"? (heard "${recurrence.phrase}")`,
        partialType: "CREATE_RECURRING_REMINDER",
      };
    }

    const dt = extractDateTime(body, now);
    const reminderTypes = detectReminderTypes(body);

    if (recurrence.kind === "RECURRENCE") {
      const title = cleanTitle(body, dt?.matchedFragments ?? []).replace(/\bevery\s+[a-z0-9 ]+$/i, "").trim();
      if (!title) {
        return {
          kind: "NEEDS_CLARIFICATION",
          question: "I can do that — what should I remind you about?",
          partialType: "CREATE_RECURRING_REMINDER",
        };
      }
      const when = dt?.when ?? { date: toISODateFallback(now), time: null };
      return {
        kind: "INTENT",
        intent: {
          type: "CREATE_RECURRING_REMINDER",
          title,
          when,
          reminderTypes,
          recurrence: recurrence.recurrence,
        },
      };
    }

    const title = cleanTitle(body, dt?.matchedFragments ?? []);
    if (!title) {
      return {
        kind: "NEEDS_CLARIFICATION",
        question: "I can do that — what should I remind you about?",
        partialType: "CREATE_REMINDER",
      };
    }
    if (!dt) {
      return {
        kind: "NEEDS_CLARIFICATION",
        question: `When should I remind you about "${title}"?`,
        partialType: "CREATE_REMINDER",
      };
    }
    return {
      kind: "INTENT",
      intent: { type: "CREATE_REMINDER", title, when: dt.when, reminderTypes },
    };
  }

  return {
    kind: "UNSUPPORTED",
    reason: "I don't understand that yet. I can create, snooze, complete or reschedule reminders, mark payments paid, and answer what's due today, overdue or upcoming.",
  };
}

export type { AssistantIntent };
