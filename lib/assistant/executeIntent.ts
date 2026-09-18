// V7 — execution layer.
//
// For every validated intent, calls EXISTING DataLayer methods / business
// logic directly (same-process function calls, exactly like
// lib/scheduling/dueScan.ts and todayIntelligence.ts already do) — never
// raw SQL, never a duplicated copy of due-date/urgency/escalation math.
// After a mutation, the real persisted state is re-read and verified
// before a response is generated (see the `db.get*` re-reads below).

import { db } from "@/lib/db";
import { scanAndProcessDueReminders } from "@/lib/scheduling/dueScan";
import { buildTodayViewModel } from "@/lib/scheduling/todayIntelligence";
import { getUrgency, getNeedsAttention } from "@/lib/scheduling/urgency";
import { derivePaymentCycleStatus } from "@/lib/scheduling/paymentCycles";
import { onReminderCompleted } from "@/lib/automation/engine";
import type { AssistantIntent } from "./intents";
import type { SessionContext } from "./context";
import { resolveReminder, resolvePaymentAccount } from "./resolveEntity";
import * as respond from "./respond";
import type { PaymentCycle, ReminderInput } from "@/types/reminder";

export interface ExecutionOutcome {
  ok: boolean;
  reply: string;
  resultSummary?: string;
  /** Populated on success so the caller can update conversation context. */
  referencedReminderId?: string;
  referencedPaymentAccountId?: string;
  /** Set when resolution was ambiguous or the reference couldn't be found — not an intent-execution failure. */
  needsClarification?: string;
}

function ok(reply: string, extra: Partial<ExecutionOutcome> = {}): ExecutionOutcome {
  return { ok: true, reply, ...extra };
}

function fail(reply: string): ExecutionOutcome {
  return { ok: false, reply };
}

function needsClarification(question: string): ExecutionOutcome {
  return { ok: false, reply: question, needsClarification: question };
}

function latestUnpaidCycle(cycles: PaymentCycle[]): PaymentCycle | null {
  return cycles.find((c) => c.status !== "paid") ?? null;
}

/**
 * Executes exactly one AssistantIntent. The parameter is typed as the
 * strict AssistantIntent union (see intents.ts) and this switch is
 * exhaustive with a `never`-checked default — nothing outside the 11
 * allowlisted intents can ever reach a DataLayer call from here.
 */
export async function executeIntent(intent: AssistantIntent, context: SessionContext): Promise<ExecutionOutcome> {
  const userId = db.getCurrentUserId();

  switch (intent.type) {
    case "CREATE_REMINDER": {
      const input: ReminderInput = {
        title: intent.title,
        date: intent.when.date,
        time: intent.when.time ?? undefined,
        priority: "medium",
        types: intent.reminderTypes,
      };
      const created = db.createReminder(userId, input);
      // Verify: re-read the persisted record rather than trusting the
      // return value alone.
      const verified = db.getReminder(created.id);
      if (!verified) return fail(respond.replyForFailure("create that reminder", "it didn't save"));
      return ok(respond.replyForCreated(verified, false), {
        resultSummary: `created reminder ${verified.id}`,
        referencedReminderId: verified.id,
      });
    }

    case "CREATE_RECURRING_REMINDER": {
      const input: ReminderInput = {
        title: intent.title,
        date: intent.when.date,
        time: intent.when.time ?? undefined,
        priority: "medium",
        types: Array.from(new Set([...intent.reminderTypes, "recurring" as const])),
        recurrence: {
          frequency: intent.recurrence.frequency,
          interval: intent.recurrence.interval,
          by_weekday: intent.recurrence.by_weekday ?? null,
        },
      };
      const created = db.createReminder(userId, input);
      const verified = db.getReminder(created.id);
      if (!verified) return fail(respond.replyForFailure("set up that recurring reminder", "it didn't save"));
      return ok(respond.replyForCreated(verified, true), {
        resultSummary: `created recurring reminder ${verified.id}`,
        referencedReminderId: verified.id,
      });
    }

    case "SNOOZE_REMINDER": {
      const resolved = resolveReminder(intent.reference, db.listReminders(userId), context);
      if (resolved.kind === "AMBIGUOUS") {
        return needsClarification(
          `I found a few reminders matching that: ${resolved.matches.map((r) => `"${r.title}"`).join(", ")}. Which one?`
        );
      }
      if (resolved.kind === "NOT_FOUND") {
        return needsClarification("I couldn't find a reminder matching that — could you be more specific?");
      }
      const updated = db.snoozeReminder(resolved.item.id, intent.minutes);
      if (!updated) return fail(respond.replyForFailure("snooze that reminder", "the reminder wasn't found"));
      const verified = db.getReminder(resolved.item.id);
      if (!verified || verified.status !== "snoozed") {
        return fail(respond.replyForFailure("snooze that reminder", "the change didn't persist"));
      }
      return ok(respond.replyForSnooze(verified, intent.minutes), {
        resultSummary: `snoozed reminder ${verified.id} for ${intent.minutes}m`,
        referencedReminderId: verified.id,
      });
    }

    case "COMPLETE_REMINDER": {
      const resolved = resolveReminder(intent.reference, db.listReminders(userId), context);
      if (resolved.kind === "AMBIGUOUS") {
        return needsClarification(
          `I found a few reminders matching that: ${resolved.matches.map((r) => `"${r.title}"`).join(", ")}. Which one?`
        );
      }
      if (resolved.kind === "NOT_FOUND") {
        return needsClarification("I couldn't find a reminder matching that — could you be more specific?");
      }
      const completed = db.completeReminder(resolved.item.id);
      const verified = db.getReminder(resolved.item.id);
      if (!completed || !verified || verified.status !== "completed") {
        return fail(respond.replyForFailure("mark that as done", "the change didn't persist"));
      }
      // V11 Automation Engine: same hook point as the /done API route.
      await onReminderCompleted(verified);
      return ok(respond.replyForComplete(verified), {
        resultSummary: `completed reminder ${verified.id}`,
        referencedReminderId: verified.id,
      });
    }

    case "UPDATE_REMINDER": {
      const resolved = resolveReminder(intent.reference, db.listReminders(userId), context);
      if (resolved.kind === "AMBIGUOUS") {
        return needsClarification(
          `I found a few reminders matching that: ${resolved.matches.map((r) => `"${r.title}"`).join(", ")}. Which one?`
        );
      }
      if (resolved.kind === "NOT_FOUND") {
        return needsClarification("I couldn't find a reminder matching that — could you be more specific?");
      }
      db.rescheduleReminder(resolved.item.id, intent.newWhen.date, intent.newWhen.time ?? null);
      const verified = db.getReminder(resolved.item.id);
      if (!verified || verified.date !== intent.newWhen.date) {
        return fail(respond.replyForFailure("move that reminder", "the change didn't persist"));
      }
      return ok(respond.replyForUpdate(verified), {
        resultSummary: `rescheduled reminder ${verified.id} to ${verified.date}`,
        referencedReminderId: verified.id,
      });
    }

    case "REMIND_AGAIN": {
      const resolved = resolveReminder(intent.reference, db.listReminders(userId), context);
      if (resolved.kind === "AMBIGUOUS") {
        return needsClarification(
          `I found a few reminders matching that: ${resolved.matches.map((r) => `"${r.title}"`).join(", ")}. Which one?`
        );
      }
      if (resolved.kind === "NOT_FOUND") {
        return needsClarification("I couldn't find a reminder matching that — could you be more specific?");
      }
      // Reuse the existing snooze-to-now + real due-scan pipeline instead of
      // inventing a parallel "notify now" path.
      db.snoozeReminder(resolved.item.id, 0);
      await scanAndProcessDueReminders();
      const verified = db.getReminder(resolved.item.id);
      if (!verified) return fail(respond.replyForFailure("send another reminder", "the reminder wasn't found"));
      return ok(respond.replyForRemindAgain(verified), {
        resultSummary: `re-notified reminder ${verified.id}`,
        referencedReminderId: verified.id,
      });
    }

    case "MARK_PAYMENT_PAID": {
      const resolved = resolvePaymentAccount(intent.reference, db.listPaymentAccounts(userId), context);
      if (resolved.kind === "AMBIGUOUS") {
        return needsClarification(
          `I found a few payment accounts matching that: ${resolved.matches.map((a) => `"${a.name}"`).join(", ")}. Which one?`
        );
      }
      if (resolved.kind === "NOT_FOUND") {
        return needsClarification("I couldn't find a payment account matching that — could you be more specific?");
      }
      const cycles = db.listPaymentCycles(resolved.item.id);
      const cycle = latestUnpaidCycle(cycles);
      if (!cycle) {
        return needsClarification(`${resolved.item.name} doesn't have an unpaid cycle right now — did you mean a different account?`);
      }
      // Ambiguity guard (Phase 8): more than one open unpaid cycle for the
      // same account is unusual and financially meaningful, so ask rather
      // than guess which one.
      const openCycles = cycles.filter((c) => c.status !== "paid");
      if (openCycles.length > 1) {
        return needsClarification(
          `${resolved.item.name} has ${openCycles.length} unpaid cycles (${openCycles.map((c) => c.cycle_period).join(", ")}). Which period should I mark paid?`
        );
      }
      const updated = db.markPaymentCyclePaid(cycle.id);
      const verified = db.getPaymentCycle(cycle.id);
      if (!updated || !verified || verified.status !== "paid") {
        return fail(respond.replyForFailure("mark that payment as paid", "the change didn't persist"));
      }
      return ok(respond.replyForMarkPaid(resolved.item, verified), {
        resultSummary: `marked cycle ${verified.id} paid`,
        referencedPaymentAccountId: resolved.item.id,
      });
    }

    case "QUERY_TODAY": {
      const view = buildViewModel(userId);
      return ok(respond.replyForToday(view), { resultSummary: "queried today" });
    }

    case "QUERY_OVERDUE": {
      const reminders = db.listReminders(userId);
      const now = new Date();
      const overdue = reminders.filter((r) => getUrgency(r, now) === "overdue").map((r) => r.title);
      const accounts = db.listPaymentAccounts(userId).filter((a) => a.active);
      const overduePayments = accounts
        .flatMap((a) => db.listPaymentCycles(a.id).map((c) => ({ a, c })))
        .filter(({ c }) => derivePaymentCycleStatus(c.due_date, now, c.status) === "overdue")
        .map(({ a }) => a.name);
      return ok(respond.replyForOverdue([...overdue, ...overduePayments]), { resultSummary: "queried overdue" });
    }

    case "QUERY_UPCOMING": {
      const view = buildViewModel(userId);
      const titles = view.upcoming.flatMap((g) => g.items.map((i) => i.title));
      return ok(respond.replyForUpcoming(titles), { resultSummary: "queried upcoming" });
    }

    case "QUERY_PAYMENTS": {
      const now = new Date();
      const accounts = db.listPaymentAccounts(userId).filter((a) => a.active);
      const lines = accounts
        .map((a) => {
          const cycle = latestUnpaidCycle(db.listPaymentCycles(a.id));
          if (!cycle) return null;
          const status = derivePaymentCycleStatus(cycle.due_date, now, cycle.status);
          return `${a.name} (${status.replace("_", " ")}, due ${cycle.due_date})`;
        })
        .filter((l): l is string => Boolean(l));
      return ok(respond.replyForPayments(lines), { resultSummary: "queried payments" });
    }

    // Exhaustiveness guard: TypeScript will error here if a new intent type
    // is added to the union without a case above, and at runtime any value
    // that somehow reaches here is refused rather than executed.
    default: {
      const _exhaustive: never = intent;
      void _exhaustive;
      return fail("That isn't something I can do.");
    }
  }
}

function buildViewModel(userId: string) {
  const reminders = db.listReminders(userId);
  const paymentAccounts = db.listPaymentAccounts(userId);
  const cyclesByAccount = new Map(paymentAccounts.map((a) => [a.id, db.listPaymentCycles(a.id)]));
  return buildTodayViewModel(reminders, paymentAccounts, cyclesByAccount, new Date());
}

export { getNeedsAttention };
