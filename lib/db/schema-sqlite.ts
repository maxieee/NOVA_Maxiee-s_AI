import type Database from "better-sqlite3";

/**
 * SQLite mirror of database/migrations/0001_init.sql, adapted for
 * better-sqlite3 (no gen_random_uuid()/arrays/enums — ids are generated in
 * app code, arrays are stored as JSON text).
 */
export function ensureSchema(db: Database.Database) {
  db.pragma("journal_mode = WAL");
  db.exec(`
    create table if not exists users (
      id text primary key,
      email text unique not null,
      display_name text not null default 'You',
      created_at text not null default (datetime('now'))
    );

    create table if not exists user_preferences (
      user_id text primary key references users(id) on delete cascade,
      reminder_lead_days text not null default '[7,3,1]',
      repeat_interval_minutes integer not null default 120,
      escalation_enabled integer not null default 1,
      theme text not null default 'dark',
      preferred_name text,
      nova_should_call_user text,
      default_reminder_time text not null default '09:00',
      default_snooze_minutes integer not null default 15,
      default_notification_behavior text not null default 'notify_once',
      timezone text not null default 'UTC',
      quiet_hours_start text,
      quiet_hours_end text,
      default_intensity text not null default 'normal',
      repeat_ignored_reminders integer not null default 1,
      escalate_urgent_reminders integer not null default 1,
      max_follow_up_attempts integer not null default 8,
      escalation_threshold_repeats integer not null default 3,
      phone_number text,
      updated_at text not null default (datetime('now'))
    );

    create table if not exists user_preferred_channels (
      user_id text not null references users(id) on delete cascade,
      channel text not null,
      primary key (user_id, channel)
    );

    create table if not exists personal_context_entries (
      id text primary key,
      user_id text not null references users(id) on delete cascade,
      category text not null default 'general',
      label text not null,
      value text not null,
      source text not null default 'user_entered',
      active integer not null default 1,
      created_at text not null default (datetime('now')),
      updated_at text not null default (datetime('now'))
    );

    create index if not exists idx_personal_context_user on personal_context_entries(user_id);

    create table if not exists reminder_notification_channels (
      reminder_id text not null references reminders(id) on delete cascade,
      channel text not null,
      primary key (reminder_id, channel)
    );

    create table if not exists reminder_types (
      id text primary key,
      key text unique not null,
      label text not null,
      icon text not null,
      color text not null
    );

    create table if not exists reminders (
      id text primary key,
      user_id text not null references users(id) on delete cascade,
      title text not null,
      description text,
      date text not null,
      time text,
      priority text not null default 'medium',
      notes text,
      status text not null default 'created',
      intensity text not null default 'normal',
      created_at text not null default (datetime('now')),
      updated_at text not null default (datetime('now')),
      completed_at text
    );

    create index if not exists idx_reminders_user_date on reminders(user_id, date);

    create table if not exists reminder_type_assignments (
      reminder_id text not null references reminders(id) on delete cascade,
      reminder_type_id text not null references reminder_types(id) on delete cascade,
      primary key (reminder_id, reminder_type_id)
    );

    create table if not exists payment_details (
      reminder_id text primary key references reminders(id) on delete cascade,
      amount real not null,
      currency text not null default 'USD',
      payee text,
      account_last4 text,
      category text not null default 'other',
      billing_date text,
      due_date text not null,
      autopay integer not null default 0,
      paid_status text not null default 'unpaid'
    );

    create table if not exists call_details (
      reminder_id text primary key references reminders(id) on delete cascade,
      contact_name text not null,
      phone_number text
    );

    create table if not exists meeting_details (
      reminder_id text primary key references reminders(id) on delete cascade,
      location text,
      meeting_link text,
      attendees text default '[]'
    );

    create table if not exists follow_up_details (
      reminder_id text primary key references reminders(id) on delete cascade,
      related_to text,
      last_contacted_at text
    );

    create table if not exists recurrence_rules (
      id text primary key,
      reminder_id text not null unique references reminders(id) on delete cascade,
      frequency text not null,
      interval integer not null default 1,
      by_day_of_month integer,
      by_month integer,
      by_weekday text,
      ends_at text,
      occurrences_limit integer
    );

    create table if not exists reminder_occurrences (
      id text primary key,
      reminder_id text not null references reminders(id) on delete cascade,
      scheduled_for text not null,
      fired_at text,
      status text not null default 'pending',
      repeat_count integer not null default 0,
      escalated integer not null default 0,
      follow_up_state text not null default 'pending',
      notification_attempt_count integer not null default 0,
      escalation_level integer not null default 0,
      last_notified_at text,
      next_follow_up_at text
    );

    create index if not exists idx_occurrences_reminder on reminder_occurrences(reminder_id);

    create table if not exists notifications (
      id text primary key,
      reminder_id text not null references reminders(id) on delete cascade,
      occurrence_id text not null references reminder_occurrences(id) on delete cascade,
      sent_at text not null default (datetime('now')),
      channel text not null default 'in_app',
      message text not null,
      outcome text not null default 'sent',
      attempt_number integer not null default 1,
      escalation_level integer not null default 0,
      provider_ref text
    );

    create table if not exists reminder_history (
      id text primary key,
      reminder_id text not null references reminders(id) on delete cascade,
      action text not null,
      detail text,
      created_at text not null default (datetime('now')),
      occurrence_id text references reminder_occurrences(id) on delete set null
    );

    create index if not exists idx_history_reminder on reminder_history(reminder_id);

    create table if not exists push_subscriptions (
      id text primary key,
      user_id text not null references users(id) on delete cascade,
      endpoint text not null unique,
      p256dh text not null,
      auth text not null,
      active integer not null default 1,
      failure_count integer not null default 0,
      last_failure_at text,
      created_at text not null default (datetime('now')),
      updated_at text not null default (datetime('now'))
    );

    create index if not exists idx_push_subscriptions_user on push_subscriptions(user_id);

    -- 0007_payment_intelligence.sql — recurring-obligation model layered on
    -- top of payment_details, additive only.
    create table if not exists payment_accounts (
      id text primary key,
      user_id text not null references users(id) on delete cascade,
      name text not null,
      payment_type text not null default 'OTHER',
      issuer text,
      masked_identifier text,
      active integer not null default 1,
      statement_date_rule integer not null default 1,
      due_date_rule text not null default 'fixed_day',
      fixed_due_day integer,
      due_days_after_statement integer,
      default_amount real not null default 0,
      minimum_amount real,
      autopay_enabled integer not null default 0,
      reminder_enabled integer not null default 1,
      escalation_enabled integer not null default 1,
      created_at text not null default (datetime('now')),
      updated_at text not null default (datetime('now'))
    );

    create index if not exists idx_payment_accounts_user on payment_accounts(user_id);

    create table if not exists payment_cycles (
      id text primary key,
      payment_account_id text not null references payment_accounts(id) on delete cascade,
      cycle_period text not null,
      statement_date text not null,
      due_date text not null,
      amount real not null default 0,
      minimum_amount real,
      status text not null default 'upcoming',
      paid_at text,
      reminder_id text references reminders(id) on delete set null,
      created_at text not null default (datetime('now')),
      updated_at text not null default (datetime('now')),
      unique (payment_account_id, cycle_period)
    );

    create index if not exists idx_payment_cycles_account on payment_cycles(payment_account_id);
    create index if not exists idx_payment_cycles_reminder on payment_cycles(reminder_id);

    -- 0008_proactive_intelligence.sql (V8) — per-rule/subject firing log,
    -- used both for anti-spam cooldown/dedup and a "recent activity" view.
    create table if not exists proactive_notifications (
      id text primary key,
      user_id text not null references users(id) on delete cascade,
      rule_id text not null,
      subject_type text not null,
      subject_id text not null,
      priority text not null,
      channel text,
      message text not null,
      outcome text not null,
      fired_at text not null default (datetime('now'))
    );

    create index if not exists idx_proactive_notifications_lookup
      on proactive_notifications(user_id, rule_id, subject_type, subject_id, fired_at);

    -- 0010_integrations_automation.sql (V11)
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
  `);

  migrateAddColumns(db);
}

/**
 * Idempotent "add column if missing" pass, so an existing local .sqlite
 * file created before 0003_personalization.sql picks up the new columns
 * without needing to delete/reseed the database.
 */
function migrateAddColumns(db: Database.Database) {
  const addColumn = (table: string, column: string, ddl: string) => {
    const cols = db.prepare(`pragma table_info(${table})`).all() as { name: string }[];
    if (!cols.some((c) => c.name === column)) {
      db.exec(`alter table ${table} add column ${ddl}`);
    }
  };

  addColumn("user_preferences", "preferred_name", "preferred_name text");
  addColumn("user_preferences", "nova_should_call_user", "nova_should_call_user text");
  addColumn("user_preferences", "default_reminder_time", "default_reminder_time text not null default '09:00'");
  addColumn("user_preferences", "default_snooze_minutes", "default_snooze_minutes integer not null default 15");
  addColumn(
    "user_preferences",
    "default_notification_behavior",
    "default_notification_behavior text not null default 'notify_once'"
  );
  addColumn("user_preferences", "timezone", "timezone text not null default 'UTC'");
  addColumn("user_preferences", "quiet_hours_start", "quiet_hours_start text");
  addColumn("user_preferences", "quiet_hours_end", "quiet_hours_end text");
  addColumn("user_preferences", "default_intensity", "default_intensity text not null default 'normal'");
  addColumn(
    "user_preferences",
    "repeat_ignored_reminders",
    "repeat_ignored_reminders integer not null default 1"
  );
  addColumn(
    "user_preferences",
    "escalate_urgent_reminders",
    "escalate_urgent_reminders integer not null default 1"
  );
  addColumn("reminders", "intensity", "intensity text not null default 'normal'");
  addColumn("notifications", "outcome", "outcome text not null default 'sent'");

  // 0005_followup_engine.sql — occurrence-level follow-up engine state.
  addColumn("user_preferences", "max_follow_up_attempts", "max_follow_up_attempts integer not null default 8");
  addColumn(
    "user_preferences",
    "escalation_threshold_repeats",
    "escalation_threshold_repeats integer not null default 3"
  );
  addColumn(
    "reminder_occurrences",
    "follow_up_state",
    "follow_up_state text not null default 'pending'"
  );
  addColumn(
    "reminder_occurrences",
    "notification_attempt_count",
    "notification_attempt_count integer not null default 0"
  );
  addColumn("reminder_occurrences", "escalation_level", "escalation_level integer not null default 0");
  addColumn("reminder_occurrences", "last_notified_at", "last_notified_at text");
  addColumn("reminder_occurrences", "next_follow_up_at", "next_follow_up_at text");
  addColumn("notifications", "attempt_number", "attempt_number integer not null default 1");
  addColumn("notifications", "escalation_level", "escalation_level integer not null default 0");
  addColumn("reminder_history", "occurrence_id", "occurrence_id text");

  // 0006_call_escalation.sql — real phone-call escalation.
  addColumn("user_preferences", "phone_number", "phone_number text");
  addColumn("notifications", "provider_ref", "provider_ref text");

  // 0008_proactive_intelligence.sql (V8)
  addColumn(
    "user_preferences",
    "proactive_intelligence_enabled",
    "proactive_intelligence_enabled integer not null default 1"
  );

  // 0009_long_term_memory.sql (V9) — formalize "What NOVA Knows".
  addColumn(
    "personal_context_entries",
    "source",
    "source text not null default 'user_entered'"
  );
  addColumn("personal_context_entries", "active", "active integer not null default 1");

  // 0010_integrations_automation.sql (V11) — anti-chaining marker.
  addColumn("reminders", "created_by_automation", "created_by_automation integer not null default 0");
}
