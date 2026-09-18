/**
 * V11 scratch end-to-end verification script — real DataLayer + real
 * automation engine, scratch SQLite DB in os.tmpdir(), never touching the
 * project's own database/nova.sqlite.
 */
import os from "os";
import path from "path";
import fs from "fs";

const dbPath = path.join(os.tmpdir(), `nova-e2e-verify-${Date.now()}.sqlite`);
process.env.NOVA_SQLITE_PATH = dbPath;
process.env.NOVA_DATA_SOURCE = "local";

async function main() {
  const { db } = await import("../lib/db");
  const { onReminderCompleted } = await import("../lib/automation/engine");

  const userId = await db.getCurrentUserId();

  // 1. Create the automation: "when a reminder is completed, create a follow-up reminder".
  const automation = await db.createAutomation(userId, {
    name: "Follow up on complete",
    trigger_type: "reminder_completed",
    trigger_config: {},
    action_type: "create_reminder",
    action_config: { title: "Follow-up check-in", daysFromNow: 7, priority: "medium" },
  });
  console.log("1) Created automation:", automation.id, automation.name);

  // 2. Complete a real reminder via the real existing completion path.
  const reminderA = await db.createReminder(userId, {
    title: "Pay electricity bill",
    date: "2026-09-18",
    priority: "high",
    types: ["general"],
  });
  const completedA = (await db.completeReminder(reminderA.id))!;
  console.log("2) Completed reminder A:", completedA.id, completedA.status);

  const remindersBeforeFirstFire = (await db.listReminders(userId)).length;
  const firstFire = await onReminderCompleted(completedA);
  const remindersAfterFirstFire = await db.listReminders(userId);
  console.log("3) First fire result:", JSON.stringify(firstFire));
  console.log(
    `   reminder count ${remindersBeforeFirstFire} -> ${remindersAfterFirstFire.length}`
  );
  const followUp = remindersAfterFirstFire.find((r) => r.title === "Follow-up check-in");
  console.log("   follow-up reminder created:", !!followUp, followUp?.id);

  if (firstFire.length !== 1 || firstFire[0].outcome !== "success" || !followUp) {
    throw new Error("FAIL: expected exactly one successful fire and a real follow-up reminder.");
  }

  // 4. Complete a second, UNRELATED reminder — confirm no cross-trigger duplication logic breaks.
  const reminderB = await db.createReminder(userId, {
    title: "Call the dentist",
    date: "2026-09-18",
    priority: "low",
    types: ["general"],
  });
  const completedB = (await db.completeReminder(reminderB.id))!;
  const secondFire = await onReminderCompleted(completedB);
  const remindersAfterSecond = await db.listReminders(userId);
  console.log("4) Completed unrelated reminder B, fire result:", JSON.stringify(secondFire));
  console.log(`   reminder count now: ${remindersAfterSecond.length}`);

  const followUpsAfterSecond = remindersAfterSecond.filter((r) => r.title === "Follow-up check-in");
  if (secondFire.length !== 1 || secondFire[0].outcome !== "success" || followUpsAfterSecond.length !== 2) {
    throw new Error(
      `FAIL: expected the automation to fire again for reminder B (its own follow-up), got ${followUpsAfterSecond.length} follow-ups.`
    );
  }
  console.log("   (this automation has no title filter, so it correctly fires for B too — its own follow-up, not a cross-trigger duplicate of A's)");

  // 5. Re-run the SAME completion event for reminder A again (simulating a duplicate delivery).
  const remindersBeforeReplay = (await db.listReminders(userId)).length;
  const replayFire = await onReminderCompleted(completedA);
  const remindersAfterReplay = (await db.listReminders(userId)).length;
  console.log("5) Replayed completion event for reminder A:", JSON.stringify(replayFire));
  console.log(`   reminder count ${remindersBeforeReplay} -> ${remindersAfterReplay}`);

  if (replayFire.length !== 1 || replayFire[0].outcome !== "skipped_cooldown" || remindersAfterReplay !== remindersBeforeReplay) {
    throw new Error("FAIL: expected idempotent skip on replay, no new reminder created.");
  }

  // 6. Anti-chaining: complete the automation-created follow-up reminder itself.
  const chainResult = await onReminderCompleted((await db.completeReminder(followUp!.id))!);
  console.log("6) Completed the automation-created follow-up reminder:", JSON.stringify(chainResult));
  if (chainResult.length !== 0) {
    throw new Error("FAIL: automation chaining occurred — completing an automation's own output re-fired an automation.");
  }

  console.log("\nALL CHECKS PASSED.");

  // Cleanup scratch DB files.
  for (const suffix of ["", "-wal", "-shm"]) {
    try {
      fs.unlinkSync(dbPath + suffix);
    } catch {
      /* ignore */
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
