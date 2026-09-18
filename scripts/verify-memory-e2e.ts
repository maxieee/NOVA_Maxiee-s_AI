/**
 * Manual end-to-end verification script for V9 Long-Term Memory + Context
 * (not part of the test suite) — follows the pattern of
 * scripts/verify-assistant-e2e.ts, using os.tmpdir() for the scratch
 * SQLite file per the V6 regression lesson.
 *
 * Proves: explicitly provide a memory via the real DataLayer -> persist it
 * -> simulate a process restart (vi-free: resetModules is a vitest-only
 * API, so here we simply re-import the db module fresh after clearing
 * node's require cache for it) by reopening the same scratch DB path ->
 * retrieve it -> confirm the assistant pipeline uses it as a fallback
 * default (never an override) in a real interaction -> deactivate it ->
 * confirm it is no longer retrieved.
 *
 * Usage: npx tsx scripts/verify-memory-e2e.ts
 */
import path from "path";
import fs from "fs";
import os from "os";

const DB_PATH = path.join(os.tmpdir(), `nova-verify-memory-e2e-${Date.now()}.sqlite`);
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

/** Clears every cached module so the next `import` re-opens the DB file fresh. */
function resetModuleCache() {
  for (const key of Object.keys(require.cache)) {
    delete require.cache[key];
  }
}

async function main() {
  console.log("\n=== Step 1: explicitly provide a memory via the real DataLayer ===");
  let { db } = await import("../lib/db");
  const { checkMemorySafety } = await import("../lib/memory/safety");

  const userId = db.getCurrentUserId();
  const safety = checkMemorySafety("preferred reminder time", "18:00");
  check("safety gate allows an ordinary memory", safety.ok);

  const entry = db.addPersonalContext(userId, {
    category: "reminder_preference",
    label: "preferred reminder time",
    value: "18:00",
    source: "user_entered",
  });
  check("memory persisted with source=user_entered", entry.source === "user_entered");
  check("memory persisted as active", entry.active === true);

  console.log("\n=== Step 2: simulate a restart — reopen the same scratch DB path ===");
  resetModuleCache();
  ({ db } = await import("../lib/db"));
  const reloaded = db.listPersonalContext(userId).find((e) => e.id === entry.id);
  check("memory survives a simulated restart", Boolean(reloaded), JSON.stringify(reloaded));
  check("category/label/value round-tripped", reloaded?.category === "reminder_preference" && reloaded?.value === "18:00");

  console.log("\n=== Step 3: assistant pipeline uses it as a FALLBACK, never an override ===");
  resetModuleCache();
  ({ db } = await import("../lib/db"));
  const { handleAssistantMessage } = await import("../lib/assistant/pipeline");
  const now = new Date("2026-09-18T12:00:00");

  const noTimeReply = await handleAssistantMessage(
    "remind me to water the plants tomorrow",
    "verify-memory-session",
    now
  );
  console.log(`  NOVA: ${noTimeReply.reply}`);
  const noTimeReminder = db.listReminders(userId).find((r) => r.title.toLowerCase().includes("water the plants"));
  check("unspecified time falls back to the memory (18:00)", noTimeReminder?.time === "18:00", noTimeReminder?.time ?? "null");

  const explicitTimeReply = await handleAssistantMessage(
    "remind me to feed the cat tomorrow at 7am",
    "verify-memory-session-2",
    now
  );
  console.log(`  NOVA: ${explicitTimeReply.reply}`);
  const explicitTimeReminder = db.listReminders(userId).find((r) => r.title.toLowerCase().includes("feed the cat"));
  check(
    "explicit current instruction (7am) wins over the memory",
    explicitTimeReminder?.time === "07:00",
    explicitTimeReminder?.time ?? "null"
  );

  console.log("\n=== Step 4: deactivate the memory, confirm it's no longer retrieved ===");
  db.updatePersonalContext(entry.id, { active: false });
  const afterDeactivate = db.listPersonalContext(userId).find((e) => e.id === entry.id);
  check("memory no longer appears in the active list", afterDeactivate === undefined);
  const stillExists = db.listPersonalContext(userId, { includeInactive: true }).find((e) => e.id === entry.id);
  check("memory's history is kept, not hard-deleted", stillExists?.active === false);

  const afterDeactivateReply = await handleAssistantMessage(
    "remind me to walk the dog tomorrow",
    "verify-memory-session-3",
    now
  );
  console.log(`  NOVA: ${afterDeactivateReply.reply}`);
  const afterDeactivateReminder = db
    .listReminders(userId)
    .find((r) => r.title.toLowerCase().includes("walk the dog"));
  check(
    "deactivated memory no longer used — falls back to structured default (09:00)",
    afterDeactivateReminder?.time === "09:00",
    afterDeactivateReminder?.time ?? "null"
  );

  console.log("\n=== Step 5: safety gate refuses a credential-shaped memory ===");
  const rejected = checkMemorySafety("wifi password", "hunter2");
  check("credential-shaped content is refused", !rejected.ok, rejected.reason);

  console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}\n`);
  cleanup();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  cleanup();
  process.exit(1);
});
