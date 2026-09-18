-- V4: real phone-call escalation.
-- Purely additive: no existing column/table is dropped or altered
-- destructively, and every new column has a safe default so existing rows
-- keep working unchanged.

-- The number NOVA calls/texts when a reminder escalates to "call"/"sms".
-- Deliberately separate from call_details.phone_number, which is the
-- contact info for a "Call" reminder TYPE (e.g. "call the dentist") — an
-- unrelated concept. This is the person's own number, so NOVA can reach
-- them, configured once in Settings.
alter table user_preferences add column if not exists phone_number text;

-- Widen the notifications outcome vocabulary to cover a pre-flight
-- validation rejection (e.g. a malformed E.164 number) that never even
-- reached the provider — distinct from "failed" (provider attempted and
-- rejected/errored) and "not_configured" (no provider credentials).
alter table notifications drop constraint if exists notifications_channel_check;
alter table notifications drop constraint if exists notifications_outcome_check;
alter table notifications add constraint notifications_outcome_check
  check (outcome in ('sent', 'failed', 'not_configured', 'invalid_number'));

-- Provider reference (e.g. Twilio Call SID) for a genuinely sent
-- notification, so the Activity timeline / status webhook can correlate a
-- row with the real call. Never a credential — safe to store.
alter table notifications add column if not exists provider_ref text;
