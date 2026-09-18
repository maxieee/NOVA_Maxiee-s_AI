-- NOVA personalization, notification channels & escalation
-- Adds to the existing schema without removing/renaming anything.

-- ---------------------------------------------------------------------------
-- Extend user_preferences with personalization fields
-- ---------------------------------------------------------------------------
alter table user_preferences add column if not exists preferred_name text;
alter table user_preferences add column if not exists nova_should_call_user text;
alter table user_preferences add column if not exists default_reminder_time time not null default '09:00';
alter table user_preferences add column if not exists default_snooze_minutes int not null default 15;
alter table user_preferences add column if not exists default_notification_behavior text not null default 'notify_once'
  check (default_notification_behavior in ('notify_once', 'repeat_until_done', 'silent'));
alter table user_preferences add column if not exists timezone text not null default 'UTC';
alter table user_preferences add column if not exists quiet_hours_start time;
alter table user_preferences add column if not exists quiet_hours_end time;
alter table user_preferences add column if not exists default_intensity text not null default 'normal'
  check (default_intensity in ('gentle', 'normal', 'persistent', 'critical'));
alter table user_preferences add column if not exists repeat_ignored_reminders boolean not null default true;
alter table user_preferences add column if not exists escalate_urgent_reminders boolean not null default true;

-- Preferred notification channels, as a proper join table (consistent with
-- the rest of the schema's style for many-to-many relationships).
create table if not exists user_preferred_channels (
  user_id uuid not null references users(id) on delete cascade,
  channel text not null check (channel in ('push', 'sms', 'email', 'call')),
  primary key (user_id, channel)
);

-- ---------------------------------------------------------------------------
-- "What NOVA Knows" — free-form, purely user-authored personal context
-- ---------------------------------------------------------------------------
create table if not exists personal_context_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  category text not null default 'general',
  label text not null,
  value text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_personal_context_user on personal_context_entries(user_id);

-- ---------------------------------------------------------------------------
-- Per-reminder notification channels + intensity
-- ---------------------------------------------------------------------------
alter table reminders add column if not exists intensity text not null default 'normal'
  check (intensity in ('gentle', 'normal', 'persistent', 'critical'));

create table if not exists reminder_notification_channels (
  reminder_id uuid not null references reminders(id) on delete cascade,
  channel text not null check (channel in ('push', 'sms', 'email', 'call')),
  primary key (reminder_id, channel)
);

-- Widen the notifications channel/outcome vocabulary to cover sms/call and
-- record whether delivery actually happened (never fabricated as "sent").
alter table notifications drop constraint if exists notifications_channel_check;
alter table notifications add constraint notifications_channel_check
  check (channel in ('in_app', 'push', 'email', 'sms', 'call'));
alter table notifications add column if not exists outcome text not null default 'sent'
  check (outcome in ('sent', 'failed', 'not_configured'));
