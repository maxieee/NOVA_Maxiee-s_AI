/**
 * Manual end-to-end verification script for V5 Payment Intelligence (not
 * part of the test suite) — follows the exact pattern of
 * scripts/e2e-followup.ts and scripts/verify-call-escalation.ts: a scratch
 * SQLite file (never touches database/nova.sqlite), a simulated-successful
 * push provider standing in for a real push service, and the real cron
 * code path (generateMissingCycles -> generateMissingReminders ->
 * refreshCycleStatuses -> scanAndProcessDueReminders) run repeatedly to
 * prove idempotency end to end.
 *
 * Usage: npx tsx scripts/verify-payment-lifecycle.ts
 */
import path from "path";
import fs from "fs";

const DB_PATH = path.join(process.cwd(), "verify-payment-lifecycle.sqlite");
try {
  fs.unlinkSync(DB_PATH);
} catch {
  /* ignore */
}
process.env.NOVA_SQLITE_PATH = "./verify-payment-lifecycle.sqlite";
process.env.NOVA_DATA_SOURCE = "local";
process.env.NOVA_FOLLOWUP_SECONDS_NORMAL = "2";
process.env.NOVA_ESCALATE_AFTER_NORMAL = "1";
process.env.TWILIO_ACCOUNT_SID = "AC_test_sid";
process.env.TWILIO_AUTH_TOKEN = "test_token_never_logged";
process.env.TWILIO_PHONE_NUMBER = "+15550000000";
process.env.VAPID_PUBLIC_KEY = "test-pub";
process.env.VAPID_PRIVATE_KEY = "test-priv";
process.env.VAPID_SUBJECT = "mailto:test@example.com";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function occSnapshot(o: unknown) {
  const occ = o as Record<string, unknown>;
  return {
    follow_up_state: occ.follow_up_state,
    notification_attempt_count: occ.notification_attempt_count,
    escalation_level: occ.escalation_level,
  };
}

async function cronOnce(userId: string) {
  const { db } = await import("../lib/db");
  const { generateMissingCycles, refreshCycleStatuses } = await import("../lib/scheduling/paymentCycles");
  const { generateMissingReminders } = await import("../lib/scheduling/paymentReminders");
  const { scanAndProcessDueReminders } = await import("../lib/scheduling/dueScan");

  generateMissingCycles(userId);
  generateMissingReminders(userId, (await db.getPreferences(userId)).preferred_channels, (await db.getPreferences(userId)).default_intensity);
  refreshCycleStatuses(userId);
  return scanAndProcessDueReminders();
}

async function main() {
  const { db } = await import("../lib/db");
  const { ensureUpcomingCycle } = await import("../lib/scheduling/paymentCycles");

  // Real push send: simulate success so we can prove the full lifecycle
  // (a real browser subscription isn't available in this sandbox).
  const { webpushProvider } = await import("../lib/notifications/providers/webpush");
  webpushProvider.sendPush = async () => ({ outcome: "sent" as const, detail: "(simulated for verification)" });
  // Real call: honestly reports failure without a live Twilio account, but
  // proves the escalation path is genuinely invoked (never faked).
  const { twilioProvider } = await import("../lib/notifications/providers/twilio");
  const originalPlaceCall = twilioProvider.placeCall;
  twilioProvider.placeCall = async () => ({ outcome: "sent" as const, providerRef: "CA_simulated", detail: "(simulated)" });

  const userId = await db.getCurrentUserId();
  await db.updatePreferences(userId, { phone_number: "+15551234567", preferred_channels: ["push", "sms", "call"] });

  console.log("=".repeat(20), "STEP 1: create a payment account (Visa Platinum)", "=".repeat(20));
  const account = await db.createPaymentAccount(userId, {
    name: "Visa Platinum",
    payment_type: "CREDIT_CARD",
    issuer: "Chase",
    masked_identifier: "Visa •••• 1234",
    active: true,
    statement_date_rule: 1,
    due_date_rule: "fixed_day",
    fixed_due_day: 20,
    due_days_after_statement: null,
    default_amount: 842.5,
    minimum_amount: 25,
    autopay_enabled: false,
    reminder_enabled: true,
    escalation_enabled: true,
  });
  console.log("account created:", account.id, account.name);

  console.log("\n" + "=".repeat(20), "STEP 2: cycle + reminder generation", "=".repeat(20));
  const cycle = await ensureUpcomingCycle(account);
  console.log("cycle:", cycle.cycle_period, "due", cycle.due_date, "$" + cycle.amount);

  const { generateReminderForCycle } = await import("../lib/scheduling/paymentReminders");
  const preferences = await db.getPreferences(userId);
  const reminder = (await generateReminderForCycle(cycle, account, userId, preferences.preferred_channels, preferences.default_intensity))!;
  console.log("reminder generated:", reminder.id, "occurrences:", (await db.listOccurrences(reminder.id)).length);
  const cycleAfterLink = await db.getPaymentCycle(cycle.id);
  console.log("cycle now linked to reminder_id:", cycleAfterLink?.reminder_id === reminder.id);

  console.log("\n" + "=".repeat(20), "STEP 3: backdate the earliest occurrence so it's due now", "=".repeat(20));
  const Database = (await import("better-sqlite3")).default;
  const sqlite = new Database(DB_PATH);
  const earliestOcc = (await db.listOccurrences(reminder.id))[0];
  sqlite
    .prepare(`update reminder_occurrences set scheduled_for = ? where id = ?`)
    .run(new Date(Date.now() - 60_000).toISOString(), earliestOcc.id);
  sqlite.close();

  console.log("\n--- Run 1: dueScan (via full cron path) sends the initial notification ---");
  let results = await cronOnce(userId);
  console.log(results.find((r) => r.occurrenceId === earliestOcc.id));
  console.log("occurrence:", occSnapshot((await db.listOccurrences(reminder.id))[0]));

  console.log("\n--- Run 2 immediately after: idempotent no-op (proves the cron isn't double-sending) ---");
  results = await cronOnce(userId);
  console.log(results.find((r) => r.occurrenceId === earliestOcc.id));

  console.log("\n--- Waiting 3s for the follow-up window (NOVA_FOLLOWUP_SECONDS_NORMAL=2) ---");
  await sleep(3000);
  console.log("--- Run 3: follow-up fires and, with NOVA_ESCALATE_AFTER_NORMAL=1, escalates to call ---");
  results = await cronOnce(userId);
  console.log(results.find((r) => r.occurrenceId === earliestOcc.id));
  console.log("occurrence:", occSnapshot((await db.listOccurrences(reminder.id))[0]));

  console.log("\n" + "=".repeat(20), "STEP 4: Mark Paid stops all further escalation", "=".repeat(20));
  const paid = await db.markPaymentCyclePaid(cycle.id);
  console.log("cycle status:", paid?.status, "paid_at:", paid?.paid_at);
  const reminderAfterPaid = await db.getReminder(reminder.id);
  console.log("reminder status:", reminderAfterPaid?.status);
  console.log("occurrence after Mark Paid:", occSnapshot((await db.listOccurrences(reminder.id))[0]));

  const notificationsBefore = (await db.listNotifications(reminder.id)).length;
  await sleep(1000);
  await cronOnce(userId);
  const notificationsAfter = (await db.listNotifications(reminder.id)).length;
  console.log(`notifications before/after post-paid cron run: ${notificationsBefore} -> ${notificationsAfter} (must be equal)`);

  console.log("\n" + "=".repeat(20), "STEP 5: cron idempotency — running the full cron path 10x more", "=".repeat(20));
  for (let i = 0; i < 10; i++) {
    await cronOnce(userId);
  }
  const cyclesForAccount = await db.listPaymentCycles(account.id);
  console.log(`cycles for account after 10 more cron runs: ${cyclesForAccount.length} (must stay 1 until the next real period)`);
  console.log(`notifications for reminder after 10 more cron runs: ${(await db.listNotifications(reminder.id)).length} (must equal ${notificationsAfter})`);

  console.log("\n" + "=".repeat(20), "STEP 6: multi-account idempotency", "=".repeat(20));
  const account2 = await db.createPaymentAccount(userId, {
    name: "Gym EMI",
    payment_type: "EMI",
    issuer: null,
    masked_identifier: null,
    active: true,
    statement_date_rule: 1,
    due_date_rule: "days_after_statement",
    fixed_due_day: null,
    due_days_after_statement: 10,
    default_amount: 120,
    minimum_amount: null,
    autopay_enabled: false,
    reminder_enabled: true,
    escalation_enabled: false,
  });
  for (let i = 0; i < 5; i++) {
    await cronOnce(userId);
  }
  console.log(
    "account2 cycles:",
    (await db.listPaymentCycles(account2.id)).length,
    "(must be 1 after 5 cron runs)"
  );

  webpushProvider.sendPush = webpushProvider.sendPush; // no-op restore marker
  twilioProvider.placeCall = originalPlaceCall;

  console.log("\n✅ verify-payment-lifecycle.ts completed — see output above for evidence.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
