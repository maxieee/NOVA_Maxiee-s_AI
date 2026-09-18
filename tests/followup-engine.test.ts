import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { decideFollowUp } from "@/lib/notifications/escalation";
import {
  FOLLOW_UP_INTERVAL_MINUTES,
  ESCALATE_AFTER_REPEATS,
  escalateAfterFor,
} from "@/lib/notifications/followUpConfig";
import type { FollowUpState } from "@/types/reminder";

const BASE_NOW = new Date("2026-01-01T12:00:00.000Z");

function baseInput(overrides: Partial<Parameters<typeof decideFollowUp>[0]> = {}) {
  return {
    now: BASE_NOW,
    followUpState: "pending" as FollowUpState,
    intensity: "normal" as const,
    requestedChannels: ["push" as const],
    configuredChannels: ["push" as const],
    scheduledFor: new Date(BASE_NOW.getTime() - 5 * 60_000).toISOString(), // 5 min ago, due
    lastNotifiedAt: null,
    nextFollowUpAt: null,
    notificationAttemptCount: 0,
    escalationLevel: 0,
    ...overrides,
  };
}

describe("decideFollowUp — pure occurrence-level engine", () => {
  it("1) sends the first notification for a due, never-notified occurrence", () => {
    const decision = decideFollowUp(baseInput());
    expect(decision).toEqual({ type: "send", channel: "push", escalated: false, isFirst: true });
  });

  it("2) is idempotent: a second run before next_follow_up_at is a strict no-op", () => {
    const decision = decideFollowUp(
      baseInput({
        followUpState: "notified",
        notificationAttemptCount: 1,
        lastNotifiedAt: new Date(BASE_NOW.getTime() - 1 * 60_000).toISOString(),
        nextFollowUpAt: new Date(BASE_NOW.getTime() + 60 * 60_000).toISOString(), // 1h in the future
      })
    );
    expect(decision).toEqual({ type: "no_op", reason: "waiting" });
  });

  it("11) multiple cron invocations in the same window all stay no-ops", () => {
    const input = baseInput({
      followUpState: "notified",
      notificationAttemptCount: 1,
      lastNotifiedAt: new Date(BASE_NOW.getTime() - 1 * 60_000).toISOString(),
      nextFollowUpAt: new Date(BASE_NOW.getTime() + 60 * 60_000).toISOString(),
    });
    for (let i = 0; i < 5; i++) {
      expect(decideFollowUp(input)).toEqual({ type: "no_op", reason: "waiting" });
    }
  });

  it("3) sends a follow-up once the configured interval has elapsed since last notify", () => {
    const intervalMinutes = FOLLOW_UP_INTERVAL_MINUTES.normal;
    const decision = decideFollowUp(
      baseInput({
        followUpState: "notified",
        notificationAttemptCount: 1,
        lastNotifiedAt: new Date(BASE_NOW.getTime() - (intervalMinutes + 1) * 60_000).toISOString(),
        nextFollowUpAt: new Date(BASE_NOW.getTime() - 60_000).toISOString(), // already passed
      })
    );
    expect(decision.type).toBe("send");
  });

  it("4) DONE (follow_up_state completed) stops follow-up unconditionally", () => {
    const decision = decideFollowUp(
      baseInput({ followUpState: "completed", notificationAttemptCount: 3, escalationLevel: 1 })
    );
    expect(decision).toEqual({ type: "no_op", reason: "completed" });
  });

  it("8) escalates once the intensity's repeat threshold is reached and a further channel is available", () => {
    const intervalMinutes = FOLLOW_UP_INTERVAL_MINUTES.normal;
    const threshold = ESCALATE_AFTER_REPEATS.normal; // 3
    const decision = decideFollowUp(
      baseInput({
        followUpState: "follow_up_sent",
        requestedChannels: ["push", "call"],
        configuredChannels: ["push", "call"],
        notificationAttemptCount: threshold - 1, // this send will be the Nth repeat
        lastNotifiedAt: new Date(BASE_NOW.getTime() - (intervalMinutes + 1) * 60_000).toISOString(),
        nextFollowUpAt: new Date(BASE_NOW.getTime() - 60_000).toISOString(),
      })
    );
    expect(decision).toEqual({ type: "send", channel: "call", escalated: true, isFirst: false });
  });

  it("9) never escalates to sms/call when no provider is configured — stays honest, doesn't fake success", () => {
    const decision = decideFollowUp(
      baseInput({
        followUpState: "follow_up_sent",
        requestedChannels: ["push", "call"],
        configuredChannels: ["push"], // call not configured
        notificationAttemptCount: 5,
        lastNotifiedAt: new Date(BASE_NOW.getTime() - 999 * 60_000).toISOString(),
        nextFollowUpAt: new Date(BASE_NOW.getTime() - 60_000).toISOString(),
      })
    );
    expect(decision.type).toBe("send");
    if (decision.type === "send") expect(decision.channel).toBe("push");
  });

  it("12) a completed occurrence never gets notified again even if still 'due'", () => {
    const decision = decideFollowUp(
      baseInput({
        followUpState: "completed",
        scheduledFor: new Date(BASE_NOW.getTime() - 999 * 60_000).toISOString(),
      })
    );
    expect(decision.type).toBe("no_op");
  });

  it("13) a cancelled occurrence (e.g. snoozed away) never gets notified", () => {
    const decision = decideFollowUp(baseInput({ followUpState: "cancelled" }));
    expect(decision).toEqual({ type: "no_op", reason: "cancelled" });
  });

  it("stops once the configured max attempts is reached (gentle: initial + one follow-up)", () => {
    const decision = decideFollowUp(
      baseInput({
        intensity: "gentle",
        followUpState: "follow_up_sent",
        notificationAttemptCount: 2, // initial + 1 follow-up already sent
        lastNotifiedAt: new Date(BASE_NOW.getTime() - 999 * 60_000).toISOString(),
        nextFollowUpAt: new Date(BASE_NOW.getTime() - 60_000).toISOString(),
      })
    );
    expect(decision).toEqual({ type: "stop", reason: "max_attempts_reached" });
  });

  it("does not act before the scheduled time (not yet due)", () => {
    const decision = decideFollowUp(
      baseInput({ scheduledFor: new Date(BASE_NOW.getTime() + 60 * 60_000).toISOString() })
    );
    expect(decision).toEqual({ type: "no_op", reason: "not_yet_due" });
  });
});

// ---------------------------------------------------------------------------
// Integration-style tests against the real local SQLite DataLayer + dueScan,
// covering DB-level state transitions (done/snooze/remind-again/recurring
// independence/history) that decideFollowUp alone can't exercise.
// ---------------------------------------------------------------------------
import path from "path";
import fs from "fs";
import os from "os";

describe("occurrence follow-up state via the real DataLayer + dueScan", () => {
  let dbPath: string;

  beforeEach(() => {
    vi.resetModules();
    dbPath = path.join(os.tmpdir(), `nova-followup-test-${Date.now()}-${Math.random()}.sqlite`);
    process.env.NOVA_SQLITE_PATH = dbPath;
    process.env.NOVA_DATA_SOURCE = "local";
  });

  afterEach(() => {
    delete process.env.NOVA_SQLITE_PATH;
    try {
      fs.unlinkSync(dbPath);
    } catch {
      /* ignore */
    }
  });

  async function freshDb() {
    const { db } = await import("@/lib/db");
    return db;
  }

  it("5) DONE stops follow-up on the occurrence (follow_up_state -> completed)", async () => {
    const db = await freshDb();
    const userId = await db.getCurrentUserId();
    const reminder = await db.createReminder(userId, {
      title: "Pay rent",
      date: new Date().toISOString().slice(0, 10),
      time: "00:00",
      priority: "medium",
      types: ["task"],
    } as never);

    const before = (await db.listOccurrences(reminder.id))[0];
    expect(before.follow_up_state).toBe("pending");

    await db.completeReminder(reminder.id);

    const after = (await db.listOccurrences(reminder.id))[0];
    expect(after.follow_up_state).toBe("completed");
    expect(after.next_follow_up_at).toBeNull();
  });

  it("6) SNOOZE cancels the current occurrence's follow-up and creates a fresh one", async () => {
    const db = await freshDb();
    const userId = await db.getCurrentUserId();
    const reminder = await db.createReminder(userId, {
      title: "Call bank",
      date: new Date().toISOString().slice(0, 10),
      time: "00:00",
      priority: "medium",
      types: ["task"],
    } as never);

    await db.snoozeReminder(reminder.id, 15);

    const occurrences = await db.listOccurrences(reminder.id);
    expect(occurrences).toHaveLength(2);
    const [original, fresh] = occurrences.sort(
      (a, b) => new Date(a.scheduled_for).getTime() - new Date(b.scheduled_for).getTime()
    );
    expect(original.follow_up_state).toBe("cancelled");
    expect(fresh.follow_up_state).toBe("pending");
    expect(fresh.notification_attempt_count).toBe(0);
  });

  it("7) REMIND AGAIN (snooze) does not create duplicate/uncontrolled occurrences", async () => {
    const db = await freshDb();
    const userId = await db.getCurrentUserId();
    const reminder = await db.createReminder(userId, {
      title: "Follow up with client",
      date: new Date().toISOString().slice(0, 10),
      time: "00:00",
      priority: "medium",
      types: ["task"],
    } as never);

    await db.snoozeReminder(reminder.id, 5); // "Remind Again" in the UI is snooze(5)

    const pendingCount = (await db.listOccurrences(reminder.id)).filter(
      (o) => o.status === "pending"
    ).length;
    expect(pendingCount).toBe(1);
  });

  it("10) recurring reminders: a completed occurrence's history doesn't affect the fresh next one", async () => {
    const db = await freshDb();
    const userId = await db.getCurrentUserId();
    const reminder = await db.createReminder(userId, {
      title: "Weekly standup",
      date: new Date().toISOString().slice(0, 10),
      time: "00:00",
      priority: "medium",
      types: ["task", "recurring"],
      recurrence: { frequency: "weekly", interval: 1 },
    } as never);

    const firstOccurrence = (await db.listOccurrences(reminder.id))[0];
    await db.updateOccurrenceFollowUp(firstOccurrence.id, {
      follow_up_state: "escalated",
      notification_attempt_count: 4,
      escalation_level: 2,
    });
    await db.completeReminder(reminder.id);

    // Simulate the recurring-reschedule path the done route takes.
    const nextDate = new Date();
    nextDate.setDate(nextDate.getDate() + 7);
    await db.rescheduleReminder(reminder.id, nextDate.toISOString().slice(0, 10), "00:00");
    await db.updateReminderStatus(reminder.id, "scheduled");
    const nextOccurrence = await db.addOccurrence(reminder.id, nextDate.toISOString());

    expect(nextOccurrence.follow_up_state).toBe("pending");
    expect(nextOccurrence.notification_attempt_count).toBe(0);
    expect(nextOccurrence.escalation_level).toBe(0);

    const priorOccurrence = (await db.listOccurrences(reminder.id)).find((o) => o.id === firstOccurrence.id)!;
    expect(priorOccurrence.notification_attempt_count).toBe(4); // untouched by the new occurrence
  });

  it("14) every real notification attempt writes an honest history/notifications row", async () => {
    const db = await freshDb();
    const userId = await db.getCurrentUserId();
    const reminder = await db.createReminder(userId, {
      title: "Unconfigured channel test",
      date: new Date().toISOString().slice(0, 10),
      time: "00:00",
      priority: "medium",
      types: ["task"],
    } as never);
    const occ = (await db.listOccurrences(reminder.id))[0];

    await db.logNotification({
      reminderId: reminder.id,
      occurrenceId: occ.id,
      channel: "push",
      message: "test",
      outcome: "not_configured",
      attemptNumber: 1,
      escalationLevel: 0,
    });

    const notifications = await db.listNotifications(reminder.id);
    expect(notifications).toHaveLength(1);
    expect(notifications[0].outcome).toBe("not_configured");

    const history = await db.listHistory(reminder.id);
    const notifiedEntry = history.find((h) => h.action === "notified");
    expect(notifiedEntry).toBeTruthy();
    expect(notifiedEntry!.detail).toContain("not_configured");
  });
});

describe("V3.1 — user-configurable escalation_threshold_repeats", () => {
  it("escalateAfterFor falls back to the intensity default when no override is given", () => {
    expect(escalateAfterFor("normal", undefined)).toBe(ESCALATE_AFTER_REPEATS.normal);
    expect(escalateAfterFor("persistent", null)).toBe(ESCALATE_AFTER_REPEATS.persistent);
  });

  it("escalateAfterFor rejects invalid overrides (0, negative, NaN, non-integer) and falls back safely", () => {
    expect(escalateAfterFor("normal", 0)).toBe(ESCALATE_AFTER_REPEATS.normal);
    expect(escalateAfterFor("normal", -1)).toBe(ESCALATE_AFTER_REPEATS.normal);
    expect(escalateAfterFor("normal", Number.NaN)).toBe(ESCALATE_AFTER_REPEATS.normal);
    expect(escalateAfterFor("normal", 2.5)).toBe(ESCALATE_AFTER_REPEATS.normal);
  });

  it("gentle never escalates, even with a user override", () => {
    expect(escalateAfterFor("gentle", 1)).toBe(Infinity);
  });

  it("a user threshold of 1 causes NOVA to escalate on the very first repeat", () => {
    const decision = decideFollowUp(
      baseInput({
        followUpState: "notified",
        requestedChannels: ["push", "call"],
        configuredChannels: ["push", "call"],
        notificationAttemptCount: 1, // this send is the 1st repeat (2nd attempt overall)
        lastNotifiedAt: new Date(BASE_NOW.getTime() - (FOLLOW_UP_INTERVAL_MINUTES.normal + 1) * 60_000).toISOString(),
        nextFollowUpAt: new Date(BASE_NOW.getTime() - 60_000).toISOString(),
        escalateAfterOverride: 1,
      })
    );
    expect(decision).toEqual({ type: "send", channel: "call", escalated: true, isFirst: false });
  });

  it("a user threshold of 3 delays escalation until the 3rd repeat, staying on push before that", () => {
    const notDueYet = decideFollowUp(
      baseInput({
        followUpState: "notified",
        requestedChannels: ["push", "call"],
        configuredChannels: ["push", "call"],
        notificationAttemptCount: 1, // repeat #2 of 3 needed
        lastNotifiedAt: new Date(BASE_NOW.getTime() - (FOLLOW_UP_INTERVAL_MINUTES.normal + 1) * 60_000).toISOString(),
        nextFollowUpAt: new Date(BASE_NOW.getTime() - 60_000).toISOString(),
        escalateAfterOverride: 3,
      })
    );
    expect(notDueYet).toEqual({ type: "send", channel: "push", escalated: false, isFirst: false });

    const escalatesNow = decideFollowUp(
      baseInput({
        followUpState: "follow_up_sent",
        requestedChannels: ["push", "call"],
        configuredChannels: ["push", "call"],
        notificationAttemptCount: 2, // this send is repeat #3
        lastNotifiedAt: new Date(BASE_NOW.getTime() - (FOLLOW_UP_INTERVAL_MINUTES.normal + 1) * 60_000).toISOString(),
        nextFollowUpAt: new Date(BASE_NOW.getTime() - 60_000).toISOString(),
        escalateAfterOverride: 3,
      })
    );
    expect(escalatesNow).toEqual({ type: "send", channel: "call", escalated: true, isFirst: false });
  });

  it("an invalid user threshold (0) falls back to the intensity default instead of escalating immediately", () => {
    const decision = decideFollowUp(
      baseInput({
        followUpState: "notified",
        requestedChannels: ["push", "call"],
        configuredChannels: ["push", "call"],
        notificationAttemptCount: 1, // would escalate immediately if threshold=0 were honored
        lastNotifiedAt: new Date(BASE_NOW.getTime() - (FOLLOW_UP_INTERVAL_MINUTES.normal + 1) * 60_000).toISOString(),
        nextFollowUpAt: new Date(BASE_NOW.getTime() - 60_000).toISOString(),
        escalateAfterOverride: 0,
      })
    );
    // Falls back to ESCALATE_AFTER_REPEATS.normal (3), so repeat #2 should not escalate yet.
    expect(decision).toEqual({ type: "send", channel: "push", escalated: false, isFirst: false });
  });

  it("max_follow_up_attempts (a separate control) still stops the sequence independent of the escalation threshold", () => {
    const decision = decideFollowUp(
      baseInput({
        followUpState: "follow_up_sent",
        requestedChannels: ["push", "call"],
        configuredChannels: ["push", "call"],
        notificationAttemptCount: 5,
        lastNotifiedAt: new Date(BASE_NOW.getTime() - (FOLLOW_UP_INTERVAL_MINUTES.normal + 1) * 60_000).toISOString(),
        nextFollowUpAt: new Date(BASE_NOW.getTime() - 60_000).toISOString(),
        escalateAfterOverride: 1, // would escalate immediately...
        maxAttempts: 5, // ...but the attempt ceiling was already reached first
      })
    );
    expect(decision).toEqual({ type: "stop", reason: "max_attempts_reached" });
  });

  it("a completed occurrence never escalates regardless of threshold", () => {
    const decision = decideFollowUp(
      baseInput({
        followUpState: "completed",
        notificationAttemptCount: 5,
        escalateAfterOverride: 1,
      })
    );
    expect(decision).toEqual({ type: "no_op", reason: "completed" });
  });

  it("a cancelled occurrence never escalates regardless of threshold", () => {
    const decision = decideFollowUp(
      baseInput({
        followUpState: "cancelled",
        notificationAttemptCount: 5,
        escalateAfterOverride: 1,
      })
    );
    expect(decision).toEqual({ type: "no_op", reason: "cancelled" });
  });

  it("a low threshold never fakes escalation to an unconfigured channel — stays on push honestly", () => {
    const decision = decideFollowUp(
      baseInput({
        followUpState: "notified",
        requestedChannels: ["push", "call"],
        configuredChannels: ["push"], // call requested but not configured
        notificationAttemptCount: 1,
        lastNotifiedAt: new Date(BASE_NOW.getTime() - (FOLLOW_UP_INTERVAL_MINUTES.normal + 1) * 60_000).toISOString(),
        nextFollowUpAt: new Date(BASE_NOW.getTime() - 60_000).toISOString(),
        escalateAfterOverride: 1,
      })
    );
    expect(decision.type).toBe("send");
    if (decision.type === "send") expect(decision.channel).toBe("push");
  });
});
