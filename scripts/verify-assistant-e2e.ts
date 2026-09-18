/**
 * Manual end-to-end verification script for V7 Natural Language Assistant
 * (not part of the test suite) — follows the pattern of
 * scripts/verify-payment-lifecycle.ts, but uses os.tmpdir() for the scratch
 * SQLite file per the V6 regression lesson (process.cwd() scratch files can
 * sit inside a cloud-synced folder and cause slow/flaky I/O).
 *
 * Proves: natural-language input -> parsed intent -> validated -> (entity
 * resolved where needed) -> executed via the real existing API/business
 * logic -> real DB state changed -> verified -> truthful response, for
 * CREATE_REMINDER, SNOOZE_REMINDER, COMPLETE_REMINDER, QUERY_TODAY and
 * MARK_PAYMENT_PAID.
 *
 * Usage: npx tsx scripts/verify-assistant-e2e.ts
 */
import path from "path";
import fs from "fs";
import os from "os";

const DB_PATH = path.join(os.tmpdir(), `nova-verify-assistant-e2e-${Date.now()}.sqlite`);
process.env.NOVA_SQLITE_PATH = DB_PATH;
process.env.NOVA_DATA_SOURCE = "local";

function cleanup() {
  for (const suffix of ["", "-wal", "-shm"]) {
    try {
      fs.unlinkSync(DB_PATH + suffix);
    } catch {
      /* ignore */
    }
  }
}

let failures = 0;
function check(label: string, condition: boolean, detail?: string) {
  if (condition) {
    console.log(`  OK   ${label}`);
  } else {
    failures += 1;
    console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

async function main() {
  const { handleAssistantMessage } = await import("../lib/assistant/pipeline");
  const { db } = await import("../lib/db");
  const { ensureUpcomingCycle } = await import("../lib/scheduling/paymentCycles");

  const userId = db.getCurrentUserId();
  const now = new Date("2026-09-18T12:00:00");

  console.log("\n=== CREATE_REMINDER ===");
  const createReply = await handleAssistantMessage(
    "remind me to call the accountant tomorrow at 10am",
    "e2e-session",
    now
  );
  console.log(`  NOVA: ${createReply.reply}`);
  const createdReminder = db
    .listReminders(userId)
    .find((r) => r.title.toLowerCase().includes("call the accountant"));
  check("reminder was actually persisted", Boolean(createdReminder));
  check("reminder date is correct", createdReminder?.date === "2026-09-19", createdReminder?.date);
  check("reminder time is correct", createdReminder?.time === "10:00", createdReminder?.time ?? "null");
  check("response is truthful (mentions the reminder)", /accountant/i.test(createReply.reply));

  console.log("\n=== SNOOZE_REMINDER (via 'it') ===");
  const snoozeReply = await handleAssistantMessage("snooze it for 15 minutes", "e2e-session", now);
  console.log(`  NOVA: ${snoozeReply.reply}`);
  const afterSnooze = db.getReminder(createdReminder!.id);
  check("reminder status is really 'snoozed' in the DB", afterSnooze?.status === "snoozed", afterSnooze?.status);
  check("response confirms the snooze", /snoozed/i.test(snoozeReply.reply));

  console.log("\n=== COMPLETE_REMINDER ===");
  const completeReply = await handleAssistantMessage("mark the accountant call as done", "e2e-session", now);
  console.log(`  NOVA: ${completeReply.reply}`);
  const afterComplete = db.getReminder(createdReminder!.id);
  check("reminder status is really 'completed' in the DB", afterComplete?.status === "completed", afterComplete?.status);
  check("response confirms completion", /done/i.test(completeReply.reply));

  console.log("\n=== Honest failure: completing something that doesn't exist ===");
  const failReply = await handleAssistantMessage("mark the nonexistent widget as done", "e2e-session", now);
  console.log(`  NOVA: ${failReply.reply}`);
  check("never claims success for a failed/impossible action", !/^done/i.test(failReply.reply));

  console.log("\n=== QUERY_TODAY (delegates to buildTodayViewModel) ===");
  const overdueReminder = db.createReminder(userId, {
    title: "Overdue e2e task",
    date: "2026-09-10",
    time: "09:00",
    priority: "medium",
    types: ["task"],
  });
  const todayReply = await handleAssistantMessage("what do I need to do today?", "e2e-session", now);
  console.log(`  NOVA: ${todayReply.reply}`);
  check("today summary mentions 'needing attention today'", /needing attention today/i.test(todayReply.reply));
  check("overdue count reflects the real overdue reminder", /overdue/i.test(todayReply.reply));
  check("overdue reminder is still really overdue in the DB", db.getReminder(overdueReminder.id)?.status !== "completed");

  console.log("\n=== MARK_PAYMENT_PAID ===");
  const account = db.createPaymentAccount(userId, {
    name: "E2E Test Card",
    payment_type: "CREDIT_CARD",
    issuer: "Test Bank",
    masked_identifier: "•••• 9999",
    active: true,
    statement_date_rule: 1,
    due_date_rule: "fixed_day",
    fixed_due_day: 20,
    due_days_after_statement: null,
    default_amount: 250,
    minimum_amount: 25,
    autopay_enabled: false,
    reminder_enabled: true,
    escalation_enabled: true,
  });
  const cycle = ensureUpcomingCycle(account, now);
  check("payment cycle starts unpaid", cycle.status !== "paid", cycle.status);
  const paidReply = await handleAssistantMessage("mark the E2E Test Card as paid", "e2e-session", now);
  console.log(`  NOVA: ${paidReply.reply}`);
  const verifiedCycle = db.getPaymentCycle(cycle.id);
  check("payment cycle is really 'paid' in the DB", verifiedCycle?.status === "paid", verifiedCycle?.status);
  check("response confirms the payment", /paid/i.test(paidReply.reply));

  console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}\n`);
  cleanup();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  cleanup();
  process.exit(1);
});
