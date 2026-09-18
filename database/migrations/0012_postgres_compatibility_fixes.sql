-- Phase 1 (Postgres/Supabase production DataLayer) — compatibility fixes.
--
-- WHAT WAS WRONG, CONCRETELY:
-- 0010_integrations_automation.sql and 0011_analytics.sql were written by
-- copy-adapting lib/db/schema-sqlite.ts's SQLite-flavored DDL instead of
-- following the Postgres conventions the rest of the migration set
-- (0001-0009) uses. Three genuine Postgres-incompatibilities resulted,
-- which would cause these files to fail outright against a real Postgres
-- database (never actually attempted before this pass — see the Phase 1
-- report for the honesty statement):
--
--   1. `id text primary key` / `user_id text ... references users(id)` on
--      integration_accounts, automations, automation_runs and
--      analytics_recommendations. users.id (and every other id/foreign-key
--      column in 0001-0009) is `uuid`. Postgres requires a foreign key's
--      referencing column type to match the referenced column's type, so
--      `user_id text references users(id)` (a uuid column) is rejected at
--      CREATE TABLE time with "foreign key constraint ... incompatible
--      types text and uuid" — these four tables would never actually get
--      created on Postgres.
--   2. `created_at text not null default (datetime('now'))` / the same for
--      updated_at/triggered_at. `datetime('now')` is a SQLite function; it
--      does not exist in Postgres (`function datetime(unknown) does not
--      exist`), and storing timestamps as `text` throws away all of
--      Postgres's native timestamptz comparison/ordering/timezone support
--      the rest of the schema (and the app's date-parsing code, which
--      expects ISO 8601 strings that round-trip through a real timestamp
--      type) relies on.
--   3. `enabled integer not null default 1` on automations uses SQLite's
--      integer-as-boolean convention instead of a real Postgres `boolean`,
--      inconsistent with every other flag column in 0001-0009
--      (escalation_enabled, autopay_enabled, active, etc. are all
--      `boolean`).
--
-- WHY THIS FIX IS ADDITIVE-SAFE:
-- This migration never alters or drops anything 0001-0009 created. It only
-- (re)creates, with `create table if not exists`, the four tables that
-- 0010/0011 could not successfully create against real Postgres in the
-- first place — so on a fresh Postgres/Supabase database there is no data
-- to lose. If a deployer's migration tool happens to auto-commit each
-- statement independently (so 0010/0011's other, independent statements —
-- e.g. `alter table reminders add column if not exists
-- created_by_automation` — succeeded even though the CREATE TABLE
-- statements failed), this migration is still a no-op for those and only
-- fills in the missing tables.
--
-- DEPLOYMENT NOTE: apply 0001-0009 normally. 0010 and 0011 may report
-- errors on their `create table` statements for the four tables named
-- above on a real Postgres target — that is expected per the bug above,
-- not a new problem introduced by this migration. Applying this file
-- (0012) after 0001-0011 brings the schema to the intended, working state
-- regardless of whether 0010/0011's CREATE TABLE statements for these four
-- tables succeeded or not.

-- ---------------------------------------------------------------------------
-- integration_accounts (correct: uuid ids, timestamptz, matches 0001-0009's
-- conventions)
-- ---------------------------------------------------------------------------
create table if not exists integration_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  provider text not null,
  status text not null default 'not_connected'
    check (status in ('not_connected', 'connected', 'error', 'expired')),
  access_token text,
  refresh_token text,
  expires_at timestamptz,
  connected_at timestamptz,
  last_sync_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, provider)
);

-- ---------------------------------------------------------------------------
-- automations / automation_runs
-- ---------------------------------------------------------------------------
create table if not exists automations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  name text not null,
  trigger_type text not null
    check (trigger_type in ('reminder_completed', 'payment_overdue', 'cron_daily', 'cron_weekly')),
  trigger_config text not null default '{}',
  condition_config text,
  action_type text not null check (action_type in ('create_reminder', 'send_notification')),
  action_config text not null default '{}',
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_run_at timestamptz
);

create index if not exists idx_automations_user on automations(user_id);
create index if not exists idx_automations_trigger on automations(user_id, trigger_type, enabled);

create table if not exists automation_runs (
  id uuid primary key default gen_random_uuid(),
  automation_id uuid not null references automations(id) on delete cascade,
  triggered_at timestamptz not null default now(),
  trigger_context text,
  outcome text not null check (outcome in ('success', 'failed', 'skipped_condition', 'skipped_cooldown')),
  detail text,
  created_at timestamptz not null default now()
);

create index if not exists idx_automation_runs_automation on automation_runs(automation_id, triggered_at);

-- Anti-chaining marker on reminders. 0010 already declared this column as
-- `integer not null default 0` (also inconsistent with every other flag
-- column in 0001-0009, which are all real `boolean`s). Because the column
-- from 0010 already exists on any database where 0010 ran (its ALTER TABLE
-- statements succeed independently of the failed CREATE TABLE statements
-- above), a plain `add column if not exists ... boolean` here is a silent
-- NO-OP — verified against a real Postgres 16 instance: the column stays
-- `integer`, and the app's `!!input.createdByAutomation` boolean parameter
-- then fails with "invalid input syntax for type integer" the first time
-- lib/db/supabase.ts tries to insert a real boolean into it. Convert the
-- column's type in place instead (safe/lossless: 0/1 -> false/true), then
-- add it fresh only for a database where 0010 never ran at all.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_name = 'reminders' and column_name = 'created_by_automation' and data_type = 'integer'
  ) then
    alter table reminders alter column created_by_automation drop default;
    alter table reminders alter column created_by_automation type boolean using (created_by_automation != 0);
    alter table reminders alter column created_by_automation set default false;
  end if;
end $$;

alter table reminders add column if not exists created_by_automation boolean not null default false;

-- ---------------------------------------------------------------------------
-- analytics_recommendations
-- ---------------------------------------------------------------------------
create table if not exists analytics_recommendations (
  id text primary key, -- deterministic app-generated id, e.g. "reschedule_default_time:<reminderId>" — intentionally NOT a uuid
  user_id uuid not null references users(id) on delete cascade,
  type text not null,
  subject_type text not null,
  subject_id text not null,
  payload text not null default '{}',
  status text not null default 'pending' check (status in ('pending', 'applied', 'dismissed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_analytics_recommendations_user
  on analytics_recommendations(user_id, status);
