-- V8 Proactive Intelligence: additive only, mirrors lib/db/schema-sqlite.ts.
--
-- proactive_notifications persists just enough state to make cooldown/dedup
-- work across cron invocations and to power a small "recent activity" view:
-- one row per rule+subject firing, with the real delivery outcome.

alter table user_preferences
  add column if not exists proactive_intelligence_enabled boolean not null default true;

create table if not exists proactive_notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  rule_id text not null,
  subject_type text not null,
  subject_id text not null,
  priority text not null,
  channel text,
  message text not null,
  outcome text not null,
  fired_at timestamptz not null default now()
);

create index if not exists idx_proactive_notifications_lookup
  on proactive_notifications(user_id, rule_id, subject_type, subject_id, fired_at desc);
