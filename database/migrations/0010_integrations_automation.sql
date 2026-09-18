-- V11 — Integrations + Automation
--
-- Two independent additions, both purely additive:
--
-- 1. integration_accounts: architecture for external OAuth2 connectors
--    (Google Calendar to start). No real Google Cloud credentials exist in
--    this environment, so every row will honestly sit at status
--    'not_connected' until someone with real GOOGLE_CLIENT_ID/SECRET runs
--    a real OAuth consent flow — this table never gets a fabricated
--    'connected' row from application code.
--
-- 2. automations + automation_runs: the V11 automation engine's data
--    model. Triggers are internal (reminder_completed, payment_overdue,
--    cron_daily, cron_weekly) so they need no external service. Actions
--    call ONLY existing reminder/notification creation paths (see
--    lib/automation/engine.ts) — this table never invents a parallel
--    action executor.
--
-- Anti-chaining: reminders.created_by_automation flags a reminder created
-- by an automation action. The reminder_completed trigger explicitly
-- skips reminders with created_by_automation = 1, so an automation can
-- never trigger another automation (or itself) by completing its own
-- output — a hard "no chaining" rule for this pass, not a hop-count
-- heuristic.

create table if not exists integration_accounts (
  id text primary key,
  user_id text not null references users(id) on delete cascade,
  provider text not null,
  status text not null default 'not_connected'
    check (status in ('not_connected', 'connected', 'error', 'expired')),
  access_token text,
  refresh_token text,
  expires_at text,
  connected_at text,
  last_sync_at text,
  last_error text,
  created_at text not null default (datetime('now')),
  updated_at text not null default (datetime('now')),
  unique (user_id, provider)
);

-- NOTE (documented gap, not solved here): access_token/refresh_token are
-- stored as-is. This is a single-user local app; a production deployment
-- with real credentials would need encryption-at-rest for these two
-- columns (e.g. via a KMS-backed envelope key), which is out of scope for
-- this pass since no real token will ever be written in this environment.

create table if not exists automations (
  id text primary key,
  user_id text not null references users(id) on delete cascade,
  name text not null,
  trigger_type text not null
    check (trigger_type in ('reminder_completed', 'payment_overdue', 'cron_daily', 'cron_weekly')),
  trigger_config text not null default '{}',
  condition_config text,
  action_type text not null check (action_type in ('create_reminder', 'send_notification')),
  action_config text not null default '{}',
  enabled integer not null default 1,
  created_at text not null default (datetime('now')),
  updated_at text not null default (datetime('now')),
  last_run_at text
);

create index if not exists idx_automations_user on automations(user_id);
create index if not exists idx_automations_trigger on automations(user_id, trigger_type, enabled);

create table if not exists automation_runs (
  id text primary key,
  automation_id text not null references automations(id) on delete cascade,
  triggered_at text not null default (datetime('now')),
  trigger_context text,
  outcome text not null check (outcome in ('success', 'failed', 'skipped_condition', 'skipped_cooldown')),
  detail text,
  created_at text not null default (datetime('now'))
);

create index if not exists idx_automation_runs_automation on automation_runs(automation_id, triggered_at);

-- Anti-chaining marker on the existing reminders table.
alter table reminders add column if not exists created_by_automation integer not null default 0;
