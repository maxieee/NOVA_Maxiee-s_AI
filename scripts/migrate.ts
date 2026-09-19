#!/usr/bin/env tsx
/**
 * One-time migration runner for database/migrations/*.sql against a real
 * Postgres/Supabase database. Not used by the app at runtime — this is a
 * manual ops script you run once (and safely re-run) when standing up or
 * updating a Postgres backend.
 *
 * Connection string comes ONLY from an environment variable — never
 * hardcode or pass it as a CLI argument (which would leak into shell
 * history). Accepts DATABASE_URL or SUPABASE_DB_URL, matching
 * lib/db/supabase.ts's own convention.
 *
 * Usage:
 *   DATABASE_URL="postgres://...supabase connection string..." npx tsx scripts/migrate.ts
 *
 * Splits each migration file into individual top-level statements (tracking
 * $$ ... $$ dollar-quoted blocks, e.g. 0012's `do $$ ... end $$;`) and runs
 * them one at a time. 0010/0011 contain a handful of statements that are
 * KNOWN to fail against real Postgres (documented in
 * database/migrations/0012_postgres_compatibility_fixes.sql's header) —
 * those specific, expected failures are logged as warnings and execution
 * continues; any other error aborts the run so a real problem is never
 * silently swallowed. 0012 repairs whatever 0010/0011 couldn't create.
 */
import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import { Client } from "pg";

const MIGRATIONS_DIR = join(__dirname, "..", "database", "migrations");

// Statements where a failure on real Postgres is EXPECTED and documented
// (see 0012's header) — matched by a distinctive substring so unrelated
// failures are never accidentally swallowed.
const EXPECTED_FAILURE_MARKERS = [
  "create table if not exists integration_accounts",
  "create table if not exists automations",
  "create table if not exists automation_runs",
  "create table if not exists analytics_recommendations",
  "create index if not exists idx_automations_user",
  "create index if not exists idx_automations_trigger",
  "create index if not exists idx_automation_runs_automation",
  "create index if not exists idx_analytics_recommendations_user",
];

function isExpectedFailureStatement(file: string, stmt: string): boolean {
  if (file !== "0010_integrations_automation.sql" && file !== "0011_analytics.sql") return false;
  const normalized = stmt.toLowerCase().replace(/\s+/g, " ").trim();
  return EXPECTED_FAILURE_MARKERS.some((marker) => normalized.startsWith(marker));
}

/**
 * Strip `--` line comments before splitting. Comments in these migration
 * files never appear inside a $$ ... $$ block or a string literal, so a
 * plain per-line strip is safe (and necessary — several header comments,
 * e.g. 0009's, contain semicolons that would otherwise be mistaken for
 * statement terminators).
 */
function stripLineComments(sql: string): string {
  return sql
    .split("\n")
    .map((line) => {
      const idx = line.indexOf("--");
      return idx === -1 ? line : line.slice(0, idx);
    })
    .join("\n");
}

/** Split a SQL file into individual statements, respecting $$ ... $$ dollar-quoted blocks. */
function splitStatements(sql: string): string[] {
  const cleaned = stripLineComments(sql);
  const statements: string[] = [];
  let current = "";
  let inDollarQuote = false;
  let i = 0;
  while (i < cleaned.length) {
    if (cleaned.startsWith("$$", i)) {
      inDollarQuote = !inDollarQuote;
      current += "$$";
      i += 2;
      continue;
    }
    const ch = cleaned[i];
    if (ch === ";" && !inDollarQuote) {
      current += ";";
      if (current.trim().length > 0) statements.push(current.trim());
      current = "";
      i += 1;
      continue;
    }
    current += ch;
    i += 1;
  }
  const trailing = current.trim();
  if (trailing.length > 0) statements.push(trailing);
  return statements;
}

const EXPECTED_TABLES = [
  "users",
  "user_preferences",
  "reminder_types",
  "reminders",
  "reminder_type_assignments",
  "payment_details",
  "call_details",
  "meeting_details",
  "follow_up_details",
  "recurrence_rules",
  "reminder_occurrences",
  "notifications",
  "reminder_history",
  "user_preferred_channels",
  "personal_context_entries",
  "reminder_notification_channels",
  "push_subscriptions",
  "payment_accounts",
  "payment_cycles",
  "proactive_notifications",
  "integration_accounts",
  "automations",
  "automation_runs",
  "analytics_recommendations",
];

/** Prints a post-migration summary: which expected tables exist, their row
 * counts, and the created_by_automation column type (the one column 0012
 * exists specifically to repair from 0010's integer-as-boolean bug). */
async function printVerificationSummary(client: Client): Promise<void> {
  console.log("== Verification summary ==");

  const { rows: existingTables } = await client.query<{ table_name: string }>(
    `select table_name from information_schema.tables where table_schema = 'public'`
  );
  const existingSet = new Set(existingTables.map((r) => r.table_name));

  for (const table of EXPECTED_TABLES) {
    if (!existingSet.has(table)) {
      console.log(`  MISSING  ${table}`);
      continue;
    }
    const { rows } = await client.query<{ count: string }>(`select count(*)::text as count from "${table}"`);
    console.log(`  present  ${table} (${rows[0].count} row(s))`);
  }

  const missing = EXPECTED_TABLES.filter((t) => !existingSet.has(t));

  const { rows: colRows } = await client.query<{ data_type: string }>(
    `select data_type from information_schema.columns where table_name = 'reminders' and column_name = 'created_by_automation'`
  );
  const columnType = colRows[0]?.data_type ?? "(column missing)";
  console.log(`  reminders.created_by_automation column type: ${columnType} (expected: boolean)`);

  if (missing.length > 0) {
    throw new Error(`Verification failed: missing expected table(s): ${missing.join(", ")}`);
  }
  if (columnType !== "boolean") {
    throw new Error(`Verification failed: reminders.created_by_automation is "${columnType}", expected "boolean"`);
  }
  console.log("  All expected tables present and created_by_automation is boolean. Schema verified OK.\n");
}

async function main() {
  const connectionString = process.env.DATABASE_URL || process.env.SUPABASE_DB_URL;
  if (!connectionString) {
    console.error("Set DATABASE_URL (or SUPABASE_DB_URL) to your Postgres connection string before running this script.");
    process.exit(1);
  }

  const useSsl = (process.env.NOVA_PG_SSL ?? "true").toLowerCase() !== "false";
  const client = new Client({
    connectionString,
    ssl: useSsl ? { rejectUnauthorized: false } : undefined,
  });

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  console.log(`Found ${files.length} migration files:`);
  for (const f of files) console.log(`  - ${f}`);

  await client.connect();
  console.log("\nConnected. Applying migrations...\n");

  let totalOk = 0;
  let totalExpectedFailures = 0;

  try {
    for (const file of files) {
      const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
      const statements = splitStatements(sql).filter((s) => s.length > 0);
      console.log(`== ${file} (${statements.length} statement(s)) ==`);

      for (const stmt of statements) {
        const preview = stmt.replace(/\s+/g, " ").slice(0, 90);
        try {
          await client.query(stmt);
          console.log(`  OK   ${preview}`);
          totalOk += 1;
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          if (isExpectedFailureStatement(file, stmt)) {
            console.warn(`  SKIP (expected, per 0012's documented compatibility notes): ${preview}`);
            console.warn(`       -> ${message}`);
            totalExpectedFailures += 1;
            continue;
          }
          console.error(`  FAIL ${preview}`);
          console.error(`       -> ${message}`);
          throw err;
        }
      }
      console.log("");
    }

    console.log(`Done. ${totalOk} statement(s) applied, ${totalExpectedFailures} expected/known failure(s) skipped.\n`);
    await printVerificationSummary(client);
  } finally {
    await client.end();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error("\nMigration run aborted due to an unexpected error.");
    console.error(err);
    process.exit(1);
  });
}

export { splitStatements, stripLineComments, isExpectedFailureStatement, EXPECTED_FAILURE_MARKERS, EXPECTED_TABLES };
