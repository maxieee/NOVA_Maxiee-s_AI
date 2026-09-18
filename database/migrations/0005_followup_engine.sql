-- Occurrence-level follow-up engine state.
-- Purely additive: no existing column/table is dropped or altered
-- destructively, and every new column has a safe default so existing rows
-- keep working unchanged.

alter table reminder_occurrences add column if not exists follow_up_state text not null default 'pending'
  check (follow_up_state in (
    'pending','due','notified','waiting','follow_up_sent','escalated','completed','cancelled'
  ));
alter table reminder_occurrences add column if not exists notification_attempt_count int not null default 0;
alter table reminder_occurrences add column if not exists escalation_level int not null default 0;
alter table reminder_occurrences add column if not exists last_notified_at timestamptz;
alter table reminder_occurrences add column if not exists next_follow_up_at timestamptz;

-- Extend the notification log with attempt/escalation bookkeeping so the
-- Activity timeline (and idempotency checks) can tell exactly which
-- attempt/escalation-level a given send was.
alter table notifications add column if not exists attempt_number int not null default 1;
alter table notifications add column if not exists escalation_level int not null default 0;

-- Extend reminder_history so "escalated to <channel>"/"follow-up sent"
-- entries can carry the same bookkeeping for the Activity timeline.
alter table reminder_history add column if not exists occurrence_id uuid references reminder_occurrences(id) on delete set null;

-- Centralized, user-overridable follow-up/escalation tuning (defaults
-- mirror lib/notifications/followUpConfig.ts).
alter table user_preferences add column if not exists max_follow_up_attempts int not null default 8;
alter table user_preferences add column if not exists escalation_threshold_repeats int not null default 3;
