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
      updated_at text not null default (datetime('now'))
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
      escalated integer not null default 0
    );

    create index if not exists idx_occurrences_reminder on reminder_occurrences(reminder_id);

    create table if not exists notifications (
      id text primary key,
      reminder_id text not null references reminders(id) on delete cascade,
      occurrence_id text not null references reminder_occurrences(id) on delete cascade,
      sent_at text not null default (datetime('now')),
      channel text not null default 'in_app',
      message text not null
    );

    create table if not exists reminder_history (
      id text primary key,
      reminder_id text not null references reminders(id) on delete cascade,
      action text not null,
      detail text,
      created_at text not null default (datetime('now'))
    );

    create index if not exists idx_history_reminder on reminder_history(reminder_id);
  `);
}
