/**
 * Manual end-to-end verification script for V8 Proactive Intelligence (not
 * part of the test suite) — follows the exact pattern of
 * scripts/verify-payment-lifecycle.ts: a scratch SQLite file (never touches
 * database/nova.sqlite), no notification providers configured (so delivery
 * honestly reports "not_configured"), and the real cron code path
 * (scanAndProcessDueReminders -> runProactiveIntelligence) run repeatedly to
 * prove cooldown/idempotency end to end.
 *
 * Usage: npx tsx scripts/verify-proactive-intelligence.ts
 */
import path from "path";
import fs from "fs";

const DB_PATH = path.join(process.cwd(), "verify-proactive-intelligence.sqlite");
try {
  fs.unlinkSync(DB_PATH);
} catch {
  /* ignore */
}
process.env.NOVA_SQLITE_PATH = "./verify-proactive-intelligence.sqlite";
process.env.NOVA_DATA_SOURCE = "local";
delete process.env.TWILIO_ACCOUNT_SID;
delete process.env.TWILIO_AUTH_TOKEN;
delete process.env.TWILIO_PHONE_NUMBER;
delete process.env.VAPID_PUBLIC_KEY;
delete process.env.VAPID_PRIVATE_KEY;

async function main() {
  const { db } = await import("../lib/db");
  const { generateMissingCycles, refreshCycleStatuses } = await import("../lib/scheduling/paymentCycles");
  const { generateMissingReminders } = await import("../lib/scheduling/paymentReminders");
  const { scanAndProcessDueReminders } = await import("../lib/scheduling/dueScan");
  const { runProactiveIntelligence } = await import("../lib/proactive/engine");

  const userId = await db.getCurrentUserId();

  console.log("=".repeat(20), "STEP 1: create a payment account with an already-overdue cycle", "=".repeat(20));
  const account = await db.createPaymentAccount(userId, {
    name: "Verify Card",
    payment_type: "CREDIT_CARD",
    issuer: "Chase",
    masked_identifier: "Visa •••• 4242",
    active: true,
    statement_date_rule: 1,
    due_date_rule: "fixed_day",
    fixed_due_day: 1,
    due_days_after_statement: null,
    default_amount: 412.75,
    minimum_amount: 25,
    autopay_enabled: false,
    reminder_enabled: true,
    escalation_enabled: true,
  });
  const cycle = await db.createPaymentCycle(account.id, {
    cyclePeriod: "2020-01",
    statementDate: "2020-01-01",
    dueDate: "2020-01-10", // long overdue relative to real "now"
    amount: 412.75,
    minimumAmount: 25,
  });
  console.log("account:", account.id, account.name);
  console.log("cycle:", cycle.id, "due", cycle.due_date, "$" + cycle.amount);

  console.log("\n" + "=".repeat(20), "STEP 2: run the real cron path once", "=".repeat(20));
  async function cronOnce() {
    await generateMissingCycles(userId);
    const prefs = await db.getPreferences(userId);
    await generateMissingReminders(userId, prefs.preferred_channels, prefs.default_intensity);
    await refreshCycleStatuses(userId);
    const due = await scanAndProcessDueReminders();
    const proactive = await runProactiveIntelligence();
    return { due, proactive };
  }

  const run1 = await cronOnce();
  const cycleAfterRefresh = await db.getPaymentCycle(cycle.id);
  console.log("cycle status after refresh:", cycleAfterRefresh?.status);
  const overdueHit1 = run1.proactive.find((r) => r.ruleId === "payment_overdue" && r.subjectId === cycle.id);
  console.log("proactive result for our cycle:", overdueHit1);
  console.log(
    "-> the engine detected the overdue payment and honestly reported its real delivery outcome (never fakes 'sent')."
  );

  console.log("\n" + "=".repeat(20), "STEP 3: run the cron path again immediately — must NOT re-notify", "=".repeat(20));
  const run2 = await cronOnce();
  const overdueHit2 = run2.proactive.find((r) => r.ruleId === "payment_overdue" && r.subjectId === cycle.id);
  console.log("proactive result on 2nd run:", overdueHit2);
  console.log("-> outcome must be 'suppressed_cooldown', proving the cooldown prevents a duplicate alert.");

  console.log("\n" + "=".repeat(20), "STEP 4: logged history reflects reality", "=".repeat(20));
  const history = await db.listProactiveNotifications(userId);
  const forCycle = history.filter((h) => h.subject_id === cycle.id);
  console.log(`total proactive_notifications rows for this cycle: ${forCycle.length} (must be exactly 1 — the suppressed run logs nothing new)`);
  console.log(forCycle.map((h) => ({ rule_id: h.rule_id, outcome: h.outcome, fired_at: h.fired_at })));

  console.log("\n" + "=".repeat(20), "STEP 5: 5 more cron runs stay idempotent", "=".repeat(20));
  for (let i = 0; i < 5; i++) {
    await cronOnce();
  }
  const historyAfter = (await db.listProactiveNotifications(userId)).filter((h) => h.subject_id === cycle.id);
  console.log(`rows for this cycle after 5 more runs: ${historyAfter.length} (must still be 1)`);

  const ok =
    overdueHit1 !== undefined &&
    overdueHit1.outcome !== "sent" && // no provider configured — must be honest, never faked
    overdueHit2?.outcome === "suppressed_cooldown" &&
    forCycle.length === 1 &&
    historyAfter.length === 1;

  console.log("\n" + (ok ? "✅ verify-proactive-intelligence.ts PASSED" : "❌ verify-proactive-intelligence.ts FAILED"));
  if (!ok) process.exitCode = 1;
}

main()
  .then(() => {
    try {
      fs.unlinkSync(DB_PATH);
      fs.unlinkSync(`${DB_PATH}-wal`);
      fs.unlinkSync(`${DB_PATH}-shm`);
    } catch {
      /* ignore */
    }
    process.exit(process.exitCode ?? 0);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
