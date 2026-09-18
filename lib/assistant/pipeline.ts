// V7 — the full PARSE -> VALIDATE -> RESOLVE -> EXECUTE -> VERIFY -> RESPOND
// pipeline, as one entry point shared by the HTTP route and tests/scripts.
// Entity resolution happens inside executeIntent (Phase 4/6 combined there
// since resolution needs the same live DataLayer reads execution does),
// but parse/validate happen first and can short-circuit to a clarification
// without touching the DB at all.

import { db } from "@/lib/db";
import { parse } from "./parser";
import { validate } from "./validate";
import { executeIntent } from "./executeIntent";
import { getSessionContext, recordTurn, setLastReminder, setLastPaymentAccount } from "./context";

export interface AssistantMessageResult {
  reply: string;
  resultSummary?: string;
}

export async function handleAssistantMessage(text: string, sessionId: string, now: Date = new Date()): Promise<AssistantMessageResult> {
  const userId = await db.getCurrentUserId();
  const preferences = await db.getPreferences(userId);
  const context = getSessionContext(sessionId);
  // V9: long-term memory is consulted AFTER parsing, as a fallback-only
  // hint — see lib/assistant/validate.ts's fallbackReminderTime for the
  // precedence proof (current instruction > memory > nothing).
  const memories = await db.listPersonalContext(userId);

  const parsed = parse(text, now, { recentTurns: context.recentTurns.map((t) => t.text) });
  const validated = validate(parsed, preferences, memories);

  let reply: string;
  let resultSummary: string | undefined;

  if (validated.kind === "NEEDS_CLARIFICATION") {
    reply = validated.question;
  } else if (validated.kind === "UNSUPPORTED") {
    reply = validated.reason;
  } else {
    const outcome = await executeIntent(validated.intent, context);
    reply = outcome.reply;
    resultSummary = outcome.resultSummary;
    if (outcome.ok) {
      if (outcome.referencedReminderId) setLastReminder(sessionId, outcome.referencedReminderId);
      if (outcome.referencedPaymentAccountId) setLastPaymentAccount(sessionId, outcome.referencedPaymentAccountId);
    }
  }

  recordTurn(sessionId, { text, reply, at: now.toISOString() });
  return { reply, resultSummary };
}
