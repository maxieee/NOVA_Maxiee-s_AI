-- V5: Payment Intelligence.
-- Purely additive: no existing table/column is dropped or altered
-- destructively. payment_accounts/payment_cycles are a NEW higher-level
-- recurring-obligation model layered ON TOP OF the existing per-reminder
-- payment_details table, not a replacement for it. Each payment_cycle still
-- creates a normal reminder (type "payment") with its own payment_details
-- row, so the existing reminder/follow-up/escalation engine (dueScan,
-- decideFollowUp, the provider abstraction) handles it completely
-- unmodified — payment_cycles.reminder_id just links the two.
--
-- Ad-hoc "payment" reminders created directly (not through a payment
-- account) keep working exactly as before: payment_details with no
-- payment_cycles row at all.

create table if not exists payment_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  name text not null,
  payment_type text not null default 'OTHER'
    check (payment_type in ('CREDIT_CARD', 'EMI', 'BILL', 'SUBSCRIPTION', 'OTHER')),
  issuer text,
  -- Masked identifier only (e.g. "Visa •••• 1234") — never a raw card/account number.
  masked_identifier text,
  active boolean not null default true,
  statement_date_rule integer not null default 1, -- day-of-month, clamped to month length
  due_date_rule text not null default 'fixed_day'
    check (due_date_rule in ('fixed_day', 'days_after_statement')),
  fixed_due_day integer,
  due_days_after_statement integer,
  default_amount numeric not null default 0,
  minimum_amount numeric,
  autopay_enabled boolean not null default false,
  reminder_enabled boolean not null default true,
  escalation_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_payment_accounts_user on payment_accounts(user_id);

create table if not exists payment_cycles (
  id uuid primary key default gen_random_uuid(),
  payment_account_id uuid not null references payment_accounts(id) on delete cascade,
  cycle_period text not null, -- e.g. "2026-01"
  statement_date date not null,
  due_date date not null,
  amount numeric not null default 0,
  minimum_amount numeric,
  status text not null default 'upcoming'
    check (status in ('upcoming', 'due_soon', 'due_today', 'overdue', 'paid')),
  paid_at timestamptz,
  -- The ordinary reminder (type "payment") the existing engine notifies
  -- through for this cycle. Nullable until reminder generation runs.
  reminder_id uuid references reminders(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (payment_account_id, cycle_period)
);

create index if not exists idx_payment_cycles_account on payment_cycles(payment_account_id);
create index if not exists idx_payment_cycles_reminder on payment_cycles(reminder_id);
