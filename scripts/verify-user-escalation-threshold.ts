/**
 * Throwaway manual verification (not part of npm test) that
 * user_preferences.escalation_threshold_repeats actually changes when
 * NOVA escalates, via the real DataLayer + dueScan code path, on a
 * scratch SQLite file. Usage: npx tsx scripts/verify-user-escalation-threshold.ts
 */
import path from "path";
import fs from "fs";

const DB_PATH = path.join(process.cwd(), "e2e-user-threshold.sqlite");
try {
  fs.unlinkSync(DB_PATH);
} catch {
  /* ignore */
}
process.env.NOVA_SQLITE_PATH = "./e2e-user-threshold.sqlite";
process.env.NOVA_DATA_SOURCE = "local";
process.env.NOVA_FOLLOWUP_SECONDS_NORMAL = "1"; // fast local iteration
process.env.NOVA_ESCALATE_AFTER_NORMAL = "3"; // global default, should be overridden

async function main() {
  const { db } = await import("../lib/db");
  const { scanAndProcessDueReminders } = await import("../lib/scheduling/dueScan");

  // Same technique as scripts/e2e-followup.ts: make VAPID + Twilio "look
  // configured" and stand in for the real send call with a simulated
  // success, so the state machine (not a real provider) is what's under
  // test. Production provider code is untouched.
  process.env.VAPID_PUBLIC_KEY = "test-public-key";
  process.env.VAPID_PRIVATE_KEY = "test-private-key";
  process.env.VAPID_SUBJECT = "mailto:test@example.com";
  process.env.TWILIO_ACCOUNT_SID = "test-sid";
  process.env.TWILIO_AUTH_TOKEN = "test-token";
  process.env.TWILIO_PHONE_NUMBER = "+10000000000";
  const { webpushProvider } = await import("../lib/notifications/providers/webpush");
  const { twilioProvider } = await import("../lib/notifications/providers/twilio");
  webpushProvider.sendPush = async () => ({ outcome: "sent" as const, detail: "(simulated)" });
  twilioProvider.placeCall = async () => ({ outcome: "sent" as const, detail: "(simulated)" });

  const userId = db.getCurrentUserId();

  // Set the user override to 1: NOVA should escalate to "call" on the very
  // first follow-up (repeat #1), instead of waiting for the global default
  // of 3.
  db.updatePreferences(userId, { escalation_threshold_repeats: 1 });

  const reminder = db.createReminder(userId, {
    title: "Pay credit card",
    date: new Date().toISOString().slice(0, 10),
    time: "00:00",
    priority: "high",
    types: ["payment"],
    intensity: "normal",
    channels: ["push", "call"],
  } as never);

  console.log("Preference set: escalation_threshold_repeats = 1");
  console.log("Run 1 (initial send):", await scanAndProcessDueReminders());
  console.log("  occurrence:", pick(db.listOccurrences(reminder.id)[0]));

  await new Promise((r) => setTimeout(r, 1500));

  console.log("Run 2 (after interval — should escalate to call on repeat #1):", await scanAndProcessDueReminders());
  const occ = db.listOccurrences(reminder.id)[0];
  console.log("  occurrence:", pick(occ));

  const escalatedEarly = occ.follow_up_state === "escalated" && occ.escalation_level >= 1;
  console.log(
    escalatedEarly
      ? "\nPASS: user threshold=1 caused escalation on the first repeat (would have needed 3 repeats with the global default)."
      : "\nFAIL: did not escalate as expected."
  );

  fs.unlinkSync(DB_PATH);
  process.exit(escalatedEarly ? 0 : 1);
}

function pick(o: unknown) {
  const occ = o as Record<string, unknown>;
  return {
    follow_up_state: occ.follow_up_state,
    notification_attempt_count: occ.notification_attempt_count,
    escalation_level: occ.escalation_level,
  };
}

main();
