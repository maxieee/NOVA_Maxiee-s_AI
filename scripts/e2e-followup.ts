/**
 * Manual end-to-end verification script for the follow-up engine (not part
 * of the test suite — a throwaway harness proving the state machine and
 * idempotency behave against the real DataLayer + dueScan, using a scratch
 * SQLite file so it never touches the real database/nova.sqlite).
 *
 * This sandbox has no real VAPID/Twilio credentials configured, so a live
 * push channel is honestly "not_configured" end to end (proven separately
 * below). To also demonstrate the full notified -> waiting -> follow-up ->
 * escalated -> done -> stopped progression through the REAL cron code path
 * (dueScan -> decideFollowUp -> DB), this script monkey-patches the local
 * ("not configured") provider's sendPush to simulate a successful delivery
 * — this is a test-only stand-in for a real push service, not a change to
 * production code (lib/notifications/providers/local.ts is untouched).
 *
 * Usage: npx tsx scripts/e2e-followup.ts
 */
import path from "path";
import fs from "fs";

const DB_PATH = path.join(process.cwd(), "e2e-followup.sqlite");
try {
  fs.unlinkSync(DB_PATH);
} catch {
  /* ignore */
}
process.env.NOVA_SQLITE_PATH = "./e2e-followup.sqlite";
process.env.NOVA_DATA_SOURCE = "local";
// Dev-friendly fast interval: 3 SECONDS instead of 120 minutes for "normal".
process.env.NOVA_FOLLOWUP_SECONDS_NORMAL = "3";
process.env.NOVA_ESCALATE_AFTER_NORMAL = "2";

function pick(o: unknown) {
  const occ = o as Record<string, unknown>;
  return {
    follow_up_state: occ.follow_up_state,
    notification_attempt_count: occ.notification_attempt_count,
    escalation_level: occ.escalation_level,
    next_follow_up_at: occ.next_follow_up_at,
  };
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function backdateToNow(reminderId: string) {
  const { db } = await import("../lib/db");
  const Database = (await import("better-sqlite3")).default;
  const occ = db.listOccurrences(reminderId)[0];
  const past = new Date(Date.now() - 60_000).toISOString();
  const sqlite = new Database(DB_PATH);
  sqlite.prepare(`update reminder_occurrences set scheduled_for = ? where id = ?`).run(past, occ.id);
  sqlite.close();
}

async function main() {
  const { db } = await import("../lib/db");
  const { scanAndProcessDueReminders } = await import("../lib/scheduling/dueScan");

  console.log("=".repeat(20), "PART A: honest not_configured path (real env, no monkey-patching)", "=".repeat(20));
  const honest = db.createReminder(db.getCurrentUserId(), {
    title: "Honest unconfigured-channel test",
    date: new Date().toISOString().slice(0, 10),
    time: "00:00",
    priority: "medium",
    types: ["task"],
    intensity: "normal",
    channels: ["push"],
  } as never);
  await backdateToNow(honest.id);
  let r = await scanAndProcessDueReminders();
  console.log(
    "run 1 (unconfigured push):",
    r.find((x) => x.reminderId === honest.id)
  );
  console.log("occurrence:", pick(db.listOccurrences(honest.id)[0]));
  r = await scanAndProcessDueReminders();
  console.log(
    "run 2 immediately after (idempotent no-op):",
    r.find((x) => x.reminderId === honest.id)
  );

  console.log(
    "\n" + "=".repeat(20),
    "PART B: full lifecycle with a simulated-successful push provider",
    "=".repeat(20)
  );
  // Make isWebPushConfigured() true (as if VAPID keys were set) so the
  // engine treats "push" as an available channel, then stand in for the
  // real webpush.sendNotification call with a simulated success — proving
  // the state machine without a real browser subscription.
  process.env.VAPID_PUBLIC_KEY = "test-public-key";
  process.env.VAPID_PRIVATE_KEY = "test-private-key";
  process.env.VAPID_SUBJECT = "mailto:test@example.com";
  const { webpushProvider } = await import("../lib/notifications/providers/webpush");
  const originalSendPush = webpushProvider.sendPush;
  webpushProvider.sendPush = async () => ({ outcome: "sent" as const, detail: "(simulated for e2e demo)" });

  const reminder = db.createReminder(db.getCurrentUserId(), {
    title: "E2E full-lifecycle test",
    date: new Date().toISOString().slice(0, 10),
    time: "00:00",
    priority: "high",
    types: ["task"],
    intensity: "normal",
    channels: ["push"],
  } as never);
  console.log(`created reminder ${reminder.id}`);
  await backdateToNow(reminder.id);

  console.log("\n--- Run 1: due -> initial notification sent ---");
  r = await scanAndProcessDueReminders();
  console.log(r.find((x) => x.reminderId === reminder.id));
  console.log("occurrence:", pick(db.listOccurrences(reminder.id)[0]));

  console.log("\n--- Run 2 (immediately after): idempotent no-op, same attempt count ---");
  r = await scanAndProcessDueReminders();
  console.log(r.find((x) => x.reminderId === reminder.id));
  console.log("occurrence:", pick(db.listOccurrences(reminder.id)[0]));

  console.log("\n--- Waiting 4s for the follow-up window (NOVA_FOLLOWUP_SECONDS_NORMAL=3) ---");
  await sleep(4000);
  console.log("--- Run 3: follow-up fires ---");
  r = await scanAndProcessDueReminders();
  console.log(r.find((x) => x.reminderId === reminder.id));
  console.log("occurrence:", pick(db.listOccurrences(reminder.id)[0]));

  console.log("\n--- Waiting 4s again for escalation threshold (NOVA_ESCALATE_AFTER_NORMAL=2) ---");
  await sleep(4000);
  console.log("--- Run 4: escalates ---");
  r = await scanAndProcessDueReminders();
  console.log(r.find((x) => x.reminderId === reminder.id));
  console.log("occurrence:", pick(db.listOccurrences(reminder.id)[0]));

  console.log("\n--- Calling the DONE path (db.completeReminder, same as POST /api/reminders/[id]/done) ---");
  db.completeReminder(reminder.id);
  console.log("occurrence:", pick(db.listOccurrences(reminder.id)[0]));

  await sleep(1000);
  console.log("\n--- Run 5 (after done): confirms zero further attempts ---");
  r = await scanAndProcessDueReminders();
  console.log(r.find((x) => x.reminderId === reminder.id) ?? "(no entry — occurrence excluded, already acknowledged)");

  console.log("\n--- notifications log for this reminder ---");
  console.log(db.listNotifications(reminder.id));
  console.log("\n--- reminder_history for this reminder ---");
  console.log(db.listHistory(reminder.id));

  webpushProvider.sendPush = originalSendPush;
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
