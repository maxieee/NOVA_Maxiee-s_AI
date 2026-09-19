import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { splitStatements, stripLineComments, isExpectedFailureStatement } from "../scripts/migrate";

const MIGRATIONS_DIR = join(__dirname, "..", "database", "migrations");

describe("stripLineComments", () => {
  it("removes -- comments without touching semicolons in real SQL", () => {
    const input = "-- a comment; with a semicolon\nselect 1;\n-- another; one";
    expect(stripLineComments(input)).toBe("\nselect 1;\n");
  });
});

describe("splitStatements", () => {
  it("splits plain statements on semicolons", () => {
    const sql = "create table a (id int);\ncreate table b (id int);";
    expect(splitStatements(sql)).toEqual(["create table a (id int);", "create table b (id int);"]);
  });

  it("does not split inside a $$ ... $$ dollar-quoted block", () => {
    const sql = `do $$
begin
  if true then
    raise notice 'x; y';
  end if;
end $$;
select 1;`;
    const statements = splitStatements(sql);
    expect(statements).toHaveLength(2);
    expect(statements[0]).toContain("do $$");
    expect(statements[0]).toContain("end $$;");
    expect(statements[1]).toBe("select 1;");
  });

  it("ignores semicolons that appear only inside -- comments (0009's real header)", () => {
    const sql = readFileSync(join(MIGRATIONS_DIR, "0009_long_term_memory.sql"), "utf8");
    const statements = splitStatements(sql);
    // 0009 has exactly 3 real SQL statements despite several comment-only semicolons.
    expect(statements).toHaveLength(3);
    for (const stmt of statements) {
      expect(stmt.trim().toLowerCase().startsWith("alter table") || stmt.trim().toLowerCase().startsWith("create index")).toBe(true);
    }
  });

  it("splits 0012's do $$ block as a single statement among the rest", () => {
    const sql = readFileSync(join(MIGRATIONS_DIR, "0012_postgres_compatibility_fixes.sql"), "utf8");
    const statements = splitStatements(sql);
    const doBlockStatements = statements.filter((s) => s.trim().toLowerCase().startsWith("do $$"));
    expect(doBlockStatements).toHaveLength(1);
    expect(doBlockStatements[0]).toContain("information_schema.columns");
    expect(doBlockStatements[0].trim().endsWith("end $$;")).toBe(true);
  });
});

describe("isExpectedFailureStatement", () => {
  it("flags the known-incompatible CREATE TABLE/INDEX statements in 0010", () => {
    expect(
      isExpectedFailureStatement("0010_integrations_automation.sql", "create table if not exists integration_accounts (id text primary key)")
    ).toBe(true);
    expect(isExpectedFailureStatement("0010_integrations_automation.sql", "create index if not exists idx_automations_user on automations(user_id)")).toBe(
      true
    );
  });

  it("does not flag 0010's independent, valid ALTER TABLE statement", () => {
    expect(
      isExpectedFailureStatement(
        "0010_integrations_automation.sql",
        "alter table reminders add column if not exists created_by_automation integer not null default 0"
      )
    ).toBe(false);
  });

  it("flags the known-incompatible statements in 0011", () => {
    expect(
      isExpectedFailureStatement("0011_analytics.sql", "create table if not exists analytics_recommendations (id text primary key)")
    ).toBe(true);
  });

  it("never flags anything in a well-formed file like 0001 or 0012", () => {
    expect(isExpectedFailureStatement("0001_init.sql", "create table if not exists users (id uuid primary key)")).toBe(false);
    expect(
      isExpectedFailureStatement("0012_postgres_compatibility_fixes.sql", "create table if not exists automations (id uuid primary key)")
    ).toBe(false);
  });
});
