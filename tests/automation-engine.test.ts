import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";

/**
 * V11 Automation Engine — integration coverage against a real scratch
 * SQLite DB. Follows the os.tmpdir() + beforeAll-prewarm pattern required
 * by this project (see tests/proactive-engine.test.ts, commit cc6bce0):
 * the heavy dynamic import graph is pre-warmed once, BEFORE any scratch DB
 * path is set, then each test resets modules and points at its own fresh
 * DB file.
 */
describe("Automation engine — triggers, idempotency, anti-chaining", () => {
  const dbPaths: string[] = [];

  beforeAll(async () => {
    await import("../lib/db");
    await import("../lib/automation/engine");
    await import("../lib/automation/templates");
  });

  beforeEach(() => {
    vi.resetModules();
    const dbPath = path.join(os.tmpdir(), `nova-automation-engine-test-${Date.now()}-${Math.random()}.sqlite`);
    dbPaths.push(dbPath);
    process.env.NOVA_SQLITE_PATH = dbPath;
    process.env.NOVA_DATA_SOURCE = "local";
  });

  afterAll(() => {
    for (const p of dbPaths) {
      for (const suffix of ["", "-wal", "-shm"]) {
        try {
          fs.unlinkSync(p + suffix);
        } catch {
          /* ignore */
        }
      }
    }
  });

  it("creates, lists, enables/disables and deletes an automation via DataLayer", async () => {
    const { db } = await import("../lib/db");
    const userId = db.getCurrentUserId();

    const created = db.createAutomation(userId, {
      name: "Test automation",
      trigger_type: "reminder_completed",
      trigger_config: {},
      action_type: "create_reminder",
      action_config: { title: "Follow up", daysFromNow: 3 },
    });

    expect(created.enabled).toBe(true);
    expect(db.listAutomations(userId)).toHaveLength(1);

    const disabled = db.updateAutomation(created.id, { enabled: false });
    expect(disabled?.enabled).toBe(false);

    db.deleteAutomation(created.id);
    expect(db.listAutomations(userId)).toHaveLength(0);
  });

  it("fires a reminder_completed automation exactly once and creates a real follow-up reminder", async () => {
    const { db } = await import("../lib/db");
    const { onReminderCompleted } = await import("../lib/automation/engine");
    const userId = db.getCurrentUserId();

    db.createAutomation(userId, {
      name: "Follow up on complete",
      trigger_type: "reminder_completed",
      trigger_config: {},
      action_type: "create_reminder",
      action_config: { title: "Check back in", daysFromNow: 7 },
    });

    const reminder = db.createReminder(userId, {
      title: "Pay the electricity bill",
      date: "2026-09-18",
      priority: "medium",
      types: ["general"],
    });
    const completed = db.completeReminder(reminder.id)!;

    const before = db.listReminders(userId).length;
    const results = await onReminderCompleted(completed);
    const after = db.listReminders(userId);

    expect(results).toHaveLength(1);
    expect(results[0].outcome).toBe("success");
    expect(after.length).toBe(before + 1);
    const followUp = after.find((r) => r.title === "Check back in");
    expect(followUp).toBeTruthy();
  });

  it("does not fire for an unrelated reminder completion when a title condition doesn't match", async () => {
    const { db } = await import("../lib/db");
    const { onReminderCompleted } = await import("../lib/automation/engine");
    const userId = db.getCurrentUserId();

    db.createAutomation(userId, {
      name: "Only for electricity",
      trigger_type: "reminder_completed",
      trigger_config: { titleContains: "electricity" },
      action_type: "create_reminder",
      action_config: { title: "Check back in", daysFromNow: 7 },
    });

    const unrelated = db.createReminder(userId, {
      title: "Call mom",
      date: "2026-09-18",
      priority: "low",
      types: ["general"],
    });
    const completed = db.completeReminder(unrelated.id)!;

    const before = db.listReminders(userId).length;
    const results = await onReminderCompleted(completed);
    const after = db.listReminders(userId).length;

    expect(results[0].outcome).toBe("skipped_condition");
    expect(after).toBe(before);
  });

  it("is idempotent: replaying the same completion event does not double-fire", async () => {
    const { db } = await import("../lib/db");
    const { onReminderCompleted } = await import("../lib/automation/engine");
    const userId = db.getCurrentUserId();

    db.createAutomation(userId, {
      name: "Follow up on complete",
      trigger_type: "reminder_completed",
      trigger_config: {},
      action_type: "create_reminder",
      action_config: { title: "Check back in", daysFromNow: 7 },
    });

    const reminder = db.createReminder(userId, {
      title: "Renew passport",
      date: "2026-09-18",
      priority: "high",
      types: ["general"],
    });
    const completed = db.completeReminder(reminder.id)!;

    const first = await onReminderCompleted(completed);
    const countAfterFirst = db.listReminders(userId).length;

    // Simulate the same completion event being delivered a second time.
    const second = await onReminderCompleted(completed);
    const countAfterSecond = db.listReminders(userId).length;

    expect(first[0].outcome).toBe("success");
    expect(second[0].outcome).toBe("skipped_cooldown");
    expect(countAfterSecond).toBe(countAfterFirst);
  });

  it("prevents automation chaining: completing an automation-created reminder never fires a new automation", async () => {
    const { db } = await import("../lib/db");
    const { onReminderCompleted } = await import("../lib/automation/engine");
    const userId = db.getCurrentUserId();

    db.createAutomation(userId, {
      name: "Follow up on complete",
      trigger_type: "reminder_completed",
      trigger_config: {},
      action_type: "create_reminder",
      action_config: { title: "Check back in", daysFromNow: 7 },
    });

    const source = db.createReminder(userId, {
      title: "Original task",
      date: "2026-09-18",
      priority: "medium",
      types: ["general"],
    });
    const completedSource = db.completeReminder(source.id)!;
    await onReminderCompleted(completedSource);

    const followUp = db.listReminders(userId).find((r) => r.title === "Check back in")!;
    expect(followUp).toBeTruthy();

    const totalBefore = db.listReminders(userId).length;
    const completedFollowUp = db.completeReminder(followUp.id)!;
    const chainResults = await onReminderCompleted(completedFollowUp);
    const totalAfter = db.listReminders(userId).length;

    // This would fail if chaining accidentally occurred: no second
    // follow-up reminder gets created, and the engine reports no fires.
    expect(chainResults).toHaveLength(0);
    expect(totalAfter).toBe(totalBefore);
  });

  it("fires a periodic (cron_daily) automation once per day and is idempotent across repeated evaluations", async () => {
    const { db } = await import("../lib/db");
    const { runPeriodicAutomations } = await import("../lib/automation/engine");
    const userId = db.getCurrentUserId();

    db.createAutomation(userId, {
      name: "Daily reminder",
      trigger_type: "cron_daily",
      trigger_config: {},
      action_type: "create_reminder",
      action_config: { title: "Daily check-in", daysFromNow: 0 },
    });

    const now = new Date("2026-09-18T09:00:00.000Z");
    const firstRun = await runPeriodicAutomations(now);
    const countAfterFirst = db.listReminders(userId).length;

    // Same calendar day, evaluated again (mirrors a second cron tick).
    const secondRun = await runPeriodicAutomations(new Date("2026-09-18T15:00:00.000Z"));
    const countAfterSecond = db.listReminders(userId).length;

    expect(firstRun[0].outcome).toBe("success");
    expect(secondRun[0].outcome).toBe("skipped_cooldown");
    expect(countAfterSecond).toBe(countAfterFirst);

    // A new day: fires again.
    const thirdRun = await runPeriodicAutomations(new Date("2026-09-19T09:00:00.000Z"));
    expect(thirdRun[0].outcome).toBe("success");
    expect(db.listReminders(userId).length).toBe(countAfterFirst + 1);
  });

  it("action calls the real existing reminder-creation path (createReminder), not a parallel executor", async () => {
    const { db } = await import("../lib/db");
    const { onReminderCompleted } = await import("../lib/automation/engine");
    const userId = db.getCurrentUserId();

    db.createAutomation(userId, {
      name: "Follow up on complete",
      trigger_type: "reminder_completed",
      trigger_config: {},
      action_type: "create_reminder",
      action_config: { title: "Verify real record", daysFromNow: 2, priority: "high" },
    });

    const reminder = db.createReminder(userId, {
      title: "Source",
      date: "2026-09-18",
      priority: "medium",
      types: ["general"],
    });
    const completed = db.completeReminder(reminder.id)!;
    await onReminderCompleted(completed);

    const created = db.listReminders(userId).find((r) => r.title === "Verify real record");
    expect(created).toBeTruthy();
    expect(created!.priority).toBe("high");
    expect(created!.status).toBe("scheduled");
  });
});
