-- V12 — Analytics + Self-Improvement
--
-- Analytics itself needs no new schema: every metric it computes is
-- derived by querying reminders/reminder_occurrences/notifications/
-- reminder_history/payment_cycles/automation_runs/proactive_notifications,
-- which already exist. The ONE new table is for tracking whether a
-- generated recommendation has been applied or dismissed by the user, so
-- a dismissed recommendation does not keep reappearing on every page
-- load, and an applied one is not re-suggested. Nothing here computes or
-- stores metrics; it only stores per-recommendation user decisions.
--
-- Recommendations are re-derived fresh from real data on every request
-- (see lib/analytics/recommendations.ts) and matched to a stored row by
-- a deterministic id (e.g. "reschedule_default_time:<reminderId>"), so
-- this table never needs to store the insight/metric data itself.

create table if not exists analytics_recommendations (
  id text primary key,
  user_id text not null references users(id) on delete cascade,
  type text not null,
  subject_type text not null,
  subject_id text not null,
  payload text not null default '{}',
  status text not null default 'pending' check (status in ('pending', 'applied', 'dismissed')),
  created_at text not null default (datetime('now')),
  updated_at text not null default (datetime('now'))
);

create index if not exists idx_analytics_recommendations_user
  on analytics_recommendations(user_id, status);
