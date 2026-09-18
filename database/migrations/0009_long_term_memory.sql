-- V9 — Long-Term Memory + Context
--
-- Extends the EXISTING "What NOVA Knows" table (personal_context_entries,
-- introduced in 0003_personalization.sql) rather than creating a second,
-- competing memory system. That table already is the durable, user-authored
-- fact store with its own CRUD routes and Settings UI; V9's job is to
-- formalize it (category, provenance, soft-deactivation), not replace it.
--
-- We deliberately do NOT add a `check` constraint on `category` here: the
-- column has existed since 0003 as free text (default 'general') and may
-- already contain values outside the new suggested vocabulary
-- (preference | routine | person | work | reminder_preference |
-- payment_preference | general_fact). Postgres/SQLite would both reject a
-- constraint an existing row violates; SQLite additionally cannot add a
-- CHECK via `alter table ... add column` at all. The application layer
-- (lib/memory/safety.ts + the Settings UI) enforces the suggested category
-- list for new/edited entries instead, which keeps this migration purely
-- additive and non-destructive per the project's rules.

alter table personal_context_entries add column if not exists source text not null default 'user_entered'
  check (source in ('user_entered', 'user_confirmed_from_conversation'));

-- Soft-deactivation, not hard delete: existing rows are recorded as active.
-- The existing DELETE route/behavior is left intact (hard delete remains
-- available), but the new UI path prefers deactivating so history is kept.
alter table personal_context_entries add column if not exists active boolean not null default true;

create index if not exists idx_personal_context_active on personal_context_entries(user_id, active);
