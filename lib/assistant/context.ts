// V7 — lightweight, short-term conversation context.
//
// DESIGN CHOICE (documented per V7 brief Phase 5): NOVA is a single-user,
// unauthenticated local app (see V1-V6 — await db.getCurrentUserId() is a fixed
// single user). A conversation's "what does 'it'/'that' refer to" state is
// ephemeral turn-taking scratch space, not a durable fact worth persisting
// — so this is a simple server-side in-memory Map keyed by sessionId, NOT
// a database table and NOT the existing personal_context_entries ("What
// NOVA Knows") system.
//
// Why not reuse Personal Context: that table stores explicit, durable,
// user-entered facts (e.g. "my landlord's name is ..."), surfaced anywhere
// NOVA reasons about the user, and it's edited/reviewed via its own UI.
// Session context here is the opposite in every dimension — implicit,
// short-lived (last few turns), irrelevant once the chat ends or the
// process restarts, and never shown to the user directly. Conflating the
// two would let a passing pronoun reference "leak" into NOVA's long-term
// memory of the user, which is exactly what the brief says to avoid.
//
// Trade-off accepted: this state does not survive a server restart and
// isn't shared across server instances. That's fine for a single-user
// local/PWA deployment; a multi-instance deployment would move this to a
// shared cache (e.g. Redis) behind the same interface without touching
// any caller.

export interface SessionTurn {
  text: string;
  reply: string;
  at: string; // ISO datetime
}

export interface SessionContext {
  lastReminderId?: string;
  lastPaymentAccountId?: string;
  recentTurns: SessionTurn[];
}

const MAX_TURNS = 5;
const store = new Map<string, SessionContext>();

export function getSessionContext(sessionId: string): SessionContext {
  const existing = store.get(sessionId);
  if (existing) return existing;
  const fresh: SessionContext = { recentTurns: [] };
  store.set(sessionId, fresh);
  return fresh;
}

export function recordTurn(sessionId: string, turn: SessionTurn): void {
  const ctx = getSessionContext(sessionId);
  ctx.recentTurns.push(turn);
  if (ctx.recentTurns.length > MAX_TURNS) ctx.recentTurns.shift();
}

export function setLastReminder(sessionId: string, reminderId: string): void {
  getSessionContext(sessionId).lastReminderId = reminderId;
}

export function setLastPaymentAccount(sessionId: string, accountId: string): void {
  getSessionContext(sessionId).lastPaymentAccountId = accountId;
}

/** Test/dev-only reset so tests don't leak state across cases. */
export function _resetAllSessionContext(): void {
  store.clear();
}
