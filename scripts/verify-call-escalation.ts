/**
 * Throwaway manual verification (not part of npm test) of the V4 phone-call
 * escalation path on a scratch SQLite file, using the REAL DataLayer +
 * dueScan code — never database/nova.sqlite.
 *
 * This sandbox has no real Twilio credentials, so Part A demonstrates the
 * honest "not_configured" outcome end-to-end through the real cron path.
 * Part B then proves the decision + idempotency logic with a mocked
 * Twilio response (never a real network call) — success only advances
 * follow-up state, failure never does.
 *
 * Usage: npx tsx scripts/verify-call-escalation.ts
 */
import path from "path";
import fs from "fs";

const DB_PATH = path.join(process.cwd(), "verify-call-escalation.sqlite");
try {
  fs.unlinkSync(DB_PATH);
} catch {
  /* ignore */
}
process.env.NOVA_SQLITE_PATH = "./verify-call-escalation.sqlite";
process.env.NOVA_DATA_SOURCE = "local";
process.env.NOVA_ESCALATE_AFTER_NORMAL = "1"; // escalate to call on the first follow-up

function pick(o: unknown) {
  const occ = o as Record<string, unknown>;
  return {
    follow_up_state: occ.follow_up_state,
    notification_attempt_count: occ.notification_attempt_count,
    escalation_level: occ.escalation_level,
  };
}

async function backdate(reminderId: string) {
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
  const { validatePhoneNumber } = await import("../lib/notifications/validatePhoneNumber");

  console.log("=".repeat(20), "PART A: honest not_configured path (no Twilio env vars set here)", "=".repeat(20));
  db.updatePreferences(db.getCurrentUserId(), { phone_number: "+919876543210" });
  const honest = db.createReminder(db.getCurrentUserId(), {
    title: "Call-requesting reminder, no Twilio creds",
    date: new Date().toISOString().slice(0, 10),
    time: "00:00",
    priority: "urgent",
    types: ["task"],
    intensity: "critical",
    channels: ["call"],
  } as never);
  await backdate(honest.id);
  let r = await scanAndProcessDueReminders();
  console.log("dueScan result:", r.find((x) => x.reminderId === honest.id));
  console.log("occurrence:", pick(db.listOccurrences(honest.id)[0]));
  console.log(
    "-> As expected in a sandbox with no real TWILIO_* env vars, the channel is unavailable and NOVA " +
      "honestly stops rather than fabricating a call.\n"
  );

  console.log("=".repeat(20), "PART B: mocked Twilio, success vs failure, idempotency", "=".repeat(20));
  process.env.TWILIO_ACCOUNT_SID = "test-sid";
  process.env.TWILIO_AUTH_TOKEN = "test-token";
  process.env.TWILIO_PHONE_NUMBER = "+15550000000";
  const { twilioProvider } = await import("../lib/notifications/providers/twilio");

  console.log("Pre-flight validator check: '+919876543210' valid?", validatePhoneNumber("+919876543210"));
  console.log("Pre-flight validator check: 'not-a-number' valid?", validatePhoneNumber("not-a-number"));

  twilioProvider.placeCall = async () => ({ outcome: "sent" as const, detail: "(simulated)", providerRef: "CA_simulated" });
  const success = db.createReminder(db.getCurrentUserId(), {
    title: "Call-escalated reminder (simulated success)",
    date: new Date().toISOString().slice(0, 10),
    time: "00:00",
    priority: "urgent",
    types: ["task"],
    intensity: "critical",
    channels: ["call"],
  } as never);
  await backdate(success.id);
  r = await scanAndProcessDueReminders();
  console.log("run 1 (simulated success):", r.find((x) => x.reminderId === success.id));
  console.log("occurrence:", pick(db.listOccurrences(success.id)[0]));
  r = await scanAndProcessDueReminders();
  console.log(
    "run 2 immediately after (idempotent no-op, attempt count unchanged):",
    r.find((x) => x.reminderId === success.id)
  );
  console.log("occurrence:", pick(db.listOccurrences(success.id)[0]));

  twilioProvider.placeCall = async () => ({ outcome: "failed" as const, detail: "(simulated Twilio error)" });
  const failure = db.createReminder(db.getCurrentUserId(), {
    title: "Call-escalated reminder (simulated failure)",
    date: new Date().toISOString().slice(0, 10),
    time: "00:00",
    priority: "urgent",
    types: ["task"],
    intensity: "critical",
    channels: ["call"],
  } as never);
  await backdate(failure.id);
  r = await scanAndProcessDueReminders();
  console.log("\nrun (simulated Twilio failure):", r.find((x) => x.reminderId === failure.id));
  console.log("occurrence (attempt count must stay 0):", pick(db.listOccurrences(failure.id)[0]));

  const notifications = db.listNotifications(failure.id);
  console.log("\nlogged notifications for the failed reminder:", notifications);
}

main()
  .then(() => {
    try {
      fs.unlinkSync(DB_PATH);
    } catch {
      /* ignore */
    }
    process.exit(0);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
