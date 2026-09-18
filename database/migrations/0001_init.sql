-- NOVA initial schema
-- Target: PostgreSQL (Supabase). Written to be portable enough that the
-- local SQLite mock layer (lib/db/local.ts) mirrors the same shape.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Users & preferences
-- ---------------------------------------------------------------------------
create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  email text unique not null,
  display_name text not null default 'You',
  created_at timestamptz not null default now()
);

create table if not exists user_preferences (
  user_id uuid primary key references users(id) on delete cascade,
  reminder_lead_days int[] not null default '{7,3,1}',
  repeat_interval_minutes int not null default 120,
  escalation_enabled boolean not null default true,
  theme text not null default 'dark' check (theme in ('dark','light','system')),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Reminder type taxonomy (lookup table, many-to-many with reminders)
-- ---------------------------------------------------------------------------
create table if not exists reminder_types (
  id uuid primary key default gen_random_uuid(),
  key text unique not null check (key in (
    'task','payment','call','meeting','follow_up',
    'important_date','general','recurring'
  )),
  label text not null,
  icon text not null,
  color text not null
);

-- ---------------------------------------------------------------------------
-- Core reminder entity
-- ---------------------------------------------------------------------------
create table if not exists reminders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  title text not null,
  description text,
  date date not null,
  time time,
  priority text not null default 'medium' check (priority in ('low','medium','high','urgent')),
  notes text,
  status text not null default 'created' check (status in (
    'created','scheduled','notified','snoozed','completed','cancelled'
  )),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists idx_reminders_user_date on reminders(user_id, date);
create index if not exists idx_reminders_status on reminders(status);

-- Many-to-many: a reminder can have multiple simultaneous types
create table if not exists reminder_type_assignments (
  reminder_id uuid not null references reminders(id) on delete cascade,
  reminder_type_id uuid not null references reminder_types(id) on delete cascade,
  primary key (reminder_id, reminder_type_id)
);

-- ---------------------------------------------------------------------------
-- Type-specific detail tables (1:1 with reminders, only populated when the
-- corresponding type is assigned)
-- ---------------------------------------------------------------------------
create table if not exists payment_details (
  reminder_id uuid primary key references reminders(id) on delete cascade,
  amount numeric(12,2) not null,
  currency text not null default 'USD',
  payee text,
  account_last4 text,
  category text not null default 'other' check (category in (
    'credit_card','bill','emi','subscription','loan','other'
  )),
  billing_date date,
  due_date date not null,
  autopay boolean not null default false,
  paid_status text not null default 'unpaid' check (paid_status in (
    'unpaid','paid','partially_paid','overdue'
  ))
);

create table if not exists call_details (
  reminder_id uuid primary key references reminders(id) on delete cascade,
  contact_name text not null,
  phone_number text
);

create table if not exists meeting_details (
  reminder_id uuid primary key references reminders(id) on delete cascade,
  location text,
  meeting_link text,
  attendees text[] default '{}'
);

create table if not exists follow_up_details (
  reminder_id uuid primary key references reminders(id) on delete cascade,
  related_to text,
  last_contacted_at date
);

-- Recurrence rule, present when a reminder has the 'recurring' type
create table if not exists recurrence_rules (
  id uuid primary key default gen_random_uuid(),
  reminder_id uuid not null unique references reminders(id) on delete cascade,
  frequency text not null check (frequency in ('daily','weekly','monthly','yearly','custom_days')),
  interval int not null default 1,
  by_day_of_month int,
  by_month int,
  by_weekday int[],
  ends_at date,
  occurrences_limit int
);

-- ---------------------------------------------------------------------------
-- Scheduling / lifecycle
-- ---------------------------------------------------------------------------
-- Each concrete "firing" of a reminder (a single due instance in time),
-- separate from the reminder definition itself so recurring reminders
-- generate many occurrences without duplicating the reminder row.
create table if not exists reminder_occurrences (
  id uuid primary key default gen_random_uuid(),
  reminder_id uuid not null references reminders(id) on delete cascade,
  scheduled_for timestamptz not null,
  fired_at timestamptz,
  status text not null default 'pending' check (status in (
    'pending','fired','acknowledged','missed','cancelled'
  )),
  repeat_count int not null default 0,
  escalated boolean not null default false
);

create index if not exists idx_occurrences_reminder on reminder_occurrences(reminder_id);
create index if not exists idx_occurrences_scheduled on reminder_occurrences(scheduled_for);

create table if not exists notifications (
  id uuid primary key default gen_random_uuid(),
  reminder_id uuid not null references reminders(id) on delete cascade,
  occurrence_id uuid not null references reminder_occurrences(id) on delete cascade,
  sent_at timestamptz not null default now(),
  channel text not null default 'in_app' check (channel in ('in_app','push','email')),
  message text not null
);

-- Full audit trail / completion tracking
create table if not exists reminder_history (
  id uuid primary key default gen_random_uuid(),
  reminder_id uuid not null references reminders(id) on delete cascade,
  action text not null check (action in (
    'created','updated','notified','snoozed','completed','cancelled','escalated'
  )),
  detail text,
  created_at timestamptz not null default now()
);

create index if not exists idx_history_reminder on reminder_history(reminder_id);
