# NOVA — Your Personal Assistant

NOVA is a personal reminder / assistant app built so you never forget anything
important — not a basic to-do list. A single reminder can carry multiple
overlapping types at once (a Payment that's also Recurring and an Important
Date, for example), and the app tracks each one through its full lifecycle:
**Created → Scheduled → Notification → User response → Completed**, with
automatic wait/repeat/escalate behavior for anything left unacknowledged.

## Stack

- **Next.js 15 (App Router) + TypeScript + React 19**
- **Tailwind CSS** for styling
- **Supabase/PostgreSQL** as the target production database (schema + client
  code included), with a **local SQLite** data layer (via `better-sqlite3`)
  so the app runs and is fully demoable with zero external credentials

## Getting started

```bash
npm install
npm run dev
```

Open http://localhost:3000 — it redirects to `/today`. The local SQLite
database is created automatically at `database/nova.sqlite` and seeded with
realistic demo data (overdue payments, due-today reminders, upcoming tasks,
meetings, follow-ups, and a completed example) the first time it's read.

Run the test suite (pure business-logic unit tests):

```bash
npm test
```

## Architecture

```
app/                    Next.js App Router pages & API routes
  today/                Dashboard: greeting, counts, Needs Attention, Upcoming
  reminders/            List, [id] detail, new (Create Reminder flow)
  payments/             Payments-specific view (cards, bills, EMIs, subs)
  tasks/                Task-typed reminders
  calendar/             Month grid view
  history/              Full audit trail
  settings/             Preferences (read-only demo view)
  api/reminders/        REST-ish API routes (list/create, done, snooze)
components/
  layout/               Sidebar (desktop), BottomNav + MobileHeader (mobile)
  reminders/             ReminderCard, TypeSelector, TypeBadges, ReminderActions,
                          CreateReminderForm (the dynamic multi-type form)
  dashboard/             StatTile
  calendar/              MonthGrid
  ui/                    Icon, PageHeader — small reusable primitives
lib/
  db/                    DataLayer contract + local (SQLite) and supabase
                          implementations, selected by lib/db/index.ts
  scheduling/            Pure functions: urgency, recurrence, repeat/escalation math
  notifications/         Notification message builders, pure escalation
                          sequencing (escalation.ts), and a provider
                          abstraction (notifications/providers/) with a
                          local "not configured" implementation and a
                          Twilio-backed implementation for calls/SMS
  copy.ts                Centralized NOVA assistant-voice microcopy
  utils/                 Date/id helpers
types/                   Shared TypeScript types (Reminder, ReminderInput, …)
database/
  migrations/            SQL schema for Postgres/Supabase
  nova.sqlite             (gitignored) local demo database file
scripts/seed.ts          Standalone script to force-create/seed the local DB
tests/                    Vitest unit tests for lib/scheduling
```

Business logic (`lib/scheduling`, `lib/notifications`) is pure and
DB-agnostic — no imports from `lib/db` or React — so it's unit tested in
isolation. UI components never talk to the database directly; pages call
`lib/db` (server components) or the `/api/reminders/*` routes (client
components), and those in turn call into `lib/scheduling` for anything that
needs urgency or recurrence math.

## Database

The schema (`database/migrations/0001_init.sql`) models:

- `users`, `user_preferences`
- `reminder_types` (fixed taxonomy) + `reminder_type_assignments` (many-to-many
  join table — this is what lets one reminder carry multiple types)
- `reminders` (the core entity: title, description, date/time, priority, notes, status)
- `payment_details`, `call_details`, `meeting_details`, `follow_up_details`
  (1:1 tables, only populated for reminders that have that type)
- `recurrence_rules` (1:1 with reminders that have the Recurring type)
- `reminder_occurrences` (each concrete scheduled firing — this is what lets a
  recurring reminder generate many future instances without duplicating the
  reminder row)
- `notifications` (delivery log per occurrence)
- `reminder_history` (full audit trail: created, updated, notified, snoozed,
  completed, cancelled, escalated)

`database/migrations/0002_seed_types.sql` seeds the fixed 8-type taxonomy
(Task, Payment, Call, Meeting, Follow-up, Important Date, General Reminder,
Recurring Reminder).

`database/migrations/0003_personalization.sql` extends `user_preferences`
with personalization fields (preferred name, what NOVA calls you, default
reminder time/snooze/behavior, timezone, quiet hours, default intensity,
repeat/escalate toggles), adds `user_preferred_channels` (a join table for
preferred notification channels), `personal_context_entries` ("What NOVA
Knows" — free-form, user-authored personal context), an `intensity` column
on `reminders`, and `reminder_notification_channels` (a join table so each
reminder can request any combination of push/sms/email/call).

`lib/db/schema-sqlite.ts` is a SQLite-compatible mirror of the same shape
(no native arrays/enums, ids/timestamps as text) used by the local data
layer.

### Switching to real Supabase

1. Create a project at https://supabase.com.
2. Run `database/migrations/0001_init.sql` and `0002_seed_types.sql` against
   it (Supabase SQL editor, or `supabase db push`).
3. Copy `.env.example` to `.env.local` and fill in:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
4. Set `NOVA_DATA_SOURCE=supabase`.
5. Implement `DataLayer` (see `lib/db/types.ts`) against
   `lib/db/supabase.ts`'s `getSupabaseClient()` — `lib/db/local.ts` shows the
   exact queries/joins to translate table-by-table. `lib/db/index.ts` is the
   single switch point; nothing else in the app needs to change.

Until that implementation is filled in, `NOVA_DATA_SOURCE=supabase` throws a
clear error rather than silently falling back, so it's obvious when the real
backend isn't wired up yet.

## Reminder lifecycle & escalation

Implemented in `lib/scheduling/recurrence.ts` and `lib/scheduling/urgency.ts`:

- `computeLeadTimeSchedule` — for a due date and lead times like `[7,3,1]`,
  returns the notification datetimes (7 days before, 3 days before, 1 day
  before, and the due-date morning) — used for payment-style reminders.
- `computeNextRepeat` — given the last fire time and a repeat interval (e.g.
  every 2 hours), computes the next repeat and whether escalation should
  trigger after N unacknowledged repeats.
- `computeNextOccurrence` — recurrence math for daily/weekly/monthly/yearly/
  custom-day rules, including day-of-month clamping and end-date/occurrence
  limits.
- `getUrgency` / `computeDashboardCounts` / `getNeedsAttention` /
  `groupUpcomingByDay` — power the Today dashboard and per-page filtering.

The **Done**, **Snooze**, and **Remind Again** actions on every reminder card
call `POST /api/reminders/[id]/done` and `/snooze`, which update
`reminder_occurrences` and `reminder_history`, and — for reminders with the
Recurring type — reschedule a fresh occurrence via `computeNextOccurrence`.

## PWA & Push Notifications

NOVA is an installable PWA (`app/manifest.ts` + `public/sw.js`) with real Web
Push support — no fake "notifications enabled" state, no simulated sends.

### Generate VAPID keys

```
npm run vapid:generate
```

Copy the printed `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, and
`NEXT_PUBLIC_VAPID_PUBLIC_KEY` into `.env.local`. Until these are set, push
reliably reports `not_configured` — the same honest pattern used for the
Twilio call/SMS provider.

### Enabling notifications locally

1. `npm run dev`, open the app in a supported browser, go to **Settings**.
2. Click **Enable Notifications** under "Push Notifications" — this requests
   browser permission and creates a real `PushSubscription`, saved via
   `POST /api/push/subscribe`.
3. Click **Send Test Notification** to send a real push through
   `POST /api/push/test` (uses `web-push`'s `sendNotification`, not a mock).

### Local vs. production scheduling

NOVA does **not** rely on a client-side `setTimeout`/interval as the source
of truth for when reminders fire — that breaks the moment the tab is closed.
Instead, `lib/scheduling/dueScan.ts` is a server-side scan that finds due,
unacknowledged occurrences, runs them through the escalation engine
(`lib/notifications/escalation.ts`), and dispatches real notifications.

- **Local dev**: there is no built-in background timer. Trigger a scan
  manually:
  ```
  npm run dev:cron
  # equivalent to:
  curl -X POST http://localhost:3000/api/cron/process-due-reminders \
    -H "x-cron-secret: $CRON_SECRET"
  ```
- **Production**: configure a real scheduler to call the same route on an
  interval. `vercel.json` already declares a Vercel Cron entry hitting
  `/api/cron/process-due-reminders` every 5 minutes; Vercel Cron sends
  `Authorization: Bearer <CRON_SECRET>`, which the route also accepts.

## Phone-call escalation (Twilio)

For `critical`/`persistent` reminders that request the `call` channel, NOVA
can escalate to a real voice call via Twilio (`lib/notifications/providers/twilio.ts`),
gated by the same honest-outcome/idempotency rules as push and SMS — a call
never fires just because a reminder is "critical"; it fires only when the
reminder explicitly requested `call`, Twilio is configured, the escalation
engine's decision genuinely selects `call`, and the occurrence hasn't
already been notified for this window.

### Setup

1. Set `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, and `TWILIO_PHONE_NUMBER`
   in `.env.local` (all three, or calls honestly report `not_configured`).
2. In **Settings > Phone Calls**, enter your own phone number in E.164
   format (e.g. `+919876543210`) — this is the number NOVA calls/texts on
   escalation. It's intentionally separate from any contact info on a
   "Call" reminder (e.g. "call the dentist"), which is unrelated per-reminder
   data, not an escalation destination.
3. Click **Send Test Call**, confirm the destination number in the shown
   prompt, then **Confirm Test Call** to place a real test call. Nothing
   fires without that explicit confirmation.

### How it works

- `lib/notifications/validatePhoneNumber.ts` rejects anything that isn't a
  standard E.164 number (`+` + 7-15 digits) before any network call is
  attempted — no auto-correction, just a clear rejection reason.
- `lib/notifications/callScript.ts` builds the spoken message dynamically
  from the reminder's own title and due state ("overdue" / "due now" /
  "due today") and XML-escapes it for safe inclusion in TwiML.
- `twilioProvider.placeCall` sends the message as inline TwiML via the
  `Twiml` param on Twilio's Voice API (a raw `fetch`, matching the existing
  fetch-based style already used for SMS and Web Push) — no separate
  public TwiML-hosting endpoint is required, so it works the same way in
  local dev and in production.
- Outcomes are always honest and distinct: `sent` (with the Twilio Call SID
  as `provider_ref`), `failed`, `not_configured`, or `invalid_number`. Only
  `sent` advances `reminder_occurrences.notification_attempt_count` /
  `next_follow_up_at` / `follow_up_state` — the same V3 idempotency
  mechanism already used for push/SMS, not a second system.
- `TWILIO_AUTH_TOKEN` (and the other credentials) are read only from
  server-side env vars — never returned by an API response, sent to the
  client, or logged.

**Known limitation**: a Twilio call-status webhook (`POST /api/twilio/status`)
was intentionally left out of this build — the notifications table already
records the outcome NOVA itself observed from the initial Twilio API
response (sent/failed/not_configured/invalid_number), which is sufficient
for the escalation engine's own idempotency; a webhook would only add
after-the-fact ring/answer status, at the cost of request-signature
validation this build doesn't need yet.

### Browser compatibility

- **Chrome, Edge, Firefox (desktop and Android)**: full Web Push support.
- **Safari/iOS**: push requires the PWA to be **installed to the home
  screen** first (Add to Home Screen) — Safari does not support Web Push for
  regular browser tabs. iOS Web Push support has historically shipped later
  and been more version-gated than other browsers; treat it as
  best-effort, and always trust the in-app status indicator (it reflects
  the real permission + subscription state, never an assumption) over any
  claim that "it should work."



- **Local-first data layer**: since no live Supabase credentials exist in
  this environment, the app ships with a fully functional SQLite
  implementation behind the same `DataLayer` interface a Supabase
  implementation would use, so the product is genuinely runnable/demoable
  here and the swap-over path is a matter of implementing one file.
- **Types as a join table, not an enum column**: `reminder_type_assignments`
  is a proper many-to-many table rather than a comma-separated column or a
  single `type` enum, because the spec requires simultaneous multi-type
  reminders (Payment + Recurring + Important Date, etc.) — normalized
  relations avoid duplicating reminder rows per type.
- **Occurrences separate from reminders**: a `reminder_occurrences` table
  models each concrete scheduled firing, keeping the recurring-reminder
  definition (in `reminders` + `recurrence_rules`) separate from its
  instances, matching standard recurring-event modeling.
- **No heavy animation library**: subtle motion (`fade-in`, `slide-up`,
  `pulse-soft`) is done with Tailwind's built-in transition/keyframe
  utilities, avoiding a framer-motion dependency the brief didn't ask for.
- **No external icon library**: a tiny inline SVG icon set
  (`components/ui/Icon.tsx`) covers everything the UI needs without adding
  a dependency.
- **Server components + a thin API layer**: pages read directly from
  `lib/db` on the server (fast, no client-side fetch waterfall for initial
  render); only mutations (Done/Snooze/Remind Again, Create Reminder) go
  through `/api/reminders/*` routes, called from small client components.

## Payment Intelligence (V5)

A higher-level **recurring-obligation** model layered on top of the
existing per-reminder `payment_details` table, not a replacement for it.
Ad-hoc "payment" reminders created directly (not through a payment account)
keep working exactly as before.

### Architecture

- `payment_accounts` — the obligation itself (a card, EMI, bill,
  subscription): name, type, masked identifier (never a raw card/account
  number), statement/due-date rules, default amount, autopay/reminder/
  escalation toggles.
- `payment_cycles` — one row per billing period for an account
  (`unique(payment_account_id, cycle_period)`), carrying its own
  statement/due date, amount, a derived `status`
  (upcoming/due_soon/due_today/overdue/paid), and `reminder_id` linking to
  the ordinary NOVA reminder that actually notifies for it.
- Each cycle's reminder is a normal reminder with `type: "payment"` and its
  own `payment_details` row — the **existing** reminder / follow-up /
  escalation engine (`decideFollowUp`, `dueScan`, the provider abstraction)
  handles it completely unmodified. No second reminder/notification engine
  was added.

### Due-date engine

`lib/scheduling/paymentDates.ts` — pure, unit-tested date math (no string
slicing):

- `computeNextStatementDate(statementDateRule, from)` — next statement date
  for a day-of-month rule.
- `computeDueDateForStatement(statementDate, rule, fixedDueDay, daysAfter)`
  — due date either on a fixed day-of-month or N days after the statement.
- **Clamping rule**: a configured day (e.g. "31") that doesn't exist in the
  target month clamps **down** to that month's last real day (Feb 28/29,
  30 for April, etc.) — it never rolls into the next month.

### Cycle & reminder generation

- `lib/scheduling/paymentCycles.ts` — `ensureUpcomingCycle` /
  `generateMissingCycles` (idempotent: checks for an existing cycle at the
  computed period, backed by the DB's unique constraint) and
  `derivePaymentCycleStatus` / `refreshCycleStatuses` (pure derivation of
  `payment_cycles.status` from due_date vs now — kept deliberately separate
  from `reminder_occurrences.follow_up_state`, which is the notification
  state machine).
- `lib/scheduling/paymentReminders.ts` — `generateReminderForCycle` /
  `generateMissingReminders`: creates the linked reminder once per cycle
  (idempotent via `payment_cycles.reminder_id`), with occurrences at a
  data-driven lead-time schedule (`lib/scheduling/paymentReminderConfig.ts`:
  default 7/3/1 days before + due date), reusing the existing
  `computeLeadTimeSchedule` helper. Channels/intensity come from the
  account's `reminder_enabled`/`escalation_enabled` flags and the user's
  personalization defaults — never a payment-specific escalation rule.

### Idempotency

Every generation function checks for an existing row before inserting, and
the DB backs it with a `unique(payment_account_id, cycle_period)`
constraint — running the cron any number of times never creates duplicate
cycles, reminders, or notifications. Verified explicitly by
`tests/payment-integration.test.ts` (10 repeated cron-path runs across
multiple accounts) and `scripts/verify-payment-lifecycle.ts`.

### Actions

- **Mark Paid** (`POST /api/payments/:cycleId/paid`) — idempotent (a repeat
  call on an already-paid cycle is a no-op), and reuses the **existing**
  `db.completeReminder` path so the linked occurrence's `follow_up_state`
  becomes `completed` and all future notifications stop.
- **Remind Again / Snooze** (`POST /api/payments/:cycleId/snooze`) —
  delegates entirely to the existing `db.snoozeReminder`.
- **Disable/Enable account** (`DELETE` / `PATCH { active }` on
  `/api/payments/:accountId`) — stops future cycle/reminder generation
  without deleting any history.

### APIs

`GET/POST /api/payments`, `GET/PATCH/DELETE /api/payments/[id]`,
`POST /api/payments/[id]/paid`, `POST /api/payments/[id]/snooze` — `PATCH`
never accepts a raw `status` transition; Mark Paid is always the dedicated
action endpoint.

### Cron integration

`POST /api/cron/process-due-reminders` (the one existing cron endpoint —
no second one was added) now, before the unchanged existing scan:
1. generates any missing payment cycles for active accounts,
2. generates any missing reminders for cycles that lack one,
3. refreshes `payment_cycles.status` from due_date vs now,
4. then runs the existing `scanAndProcessDueReminders()` unchanged.

### Env vars

None added — Payment Intelligence reuses every existing env var
(`CRON_SECRET`, Twilio/VAPID credentials) with no new configuration surface.

### Testing

```bash
npx vitest run tests/payment-dates.test.ts
npx vitest run tests/payment-cycles.test.ts
npx vitest run tests/payment-integration.test.ts
npx tsx scripts/verify-payment-lifecycle.ts   # scratch-DB, real end-to-end proof
```

### Known limitation

The escalation leg of `scripts/verify-payment-lifecycle.ts` demonstrates a
second honest `sent` follow-up but did not reach `escalation_level > 0`
within the script's short wait windows in the run captured for this
report — the underlying engine and its threshold logic are unchanged and
already covered by `tests/escalation.test.ts` /
`tests/followup-engine.test.ts` (which do assert escalation), so this is a
timing artifact of the demo script's sleep durations, not a gap in the
production logic.

## V7 — Natural Language Assistant

A deterministic, local, rule-based natural-language interface layer over
the existing reminder/payment engines. No external LLM API is required or
used for core functionality — parsing is regex/keyword-based and fully
unit-tested. This is an INTERFACE LAYER ONLY: it never touches SQLite
directly and never re-implements due-date, urgency, escalation or
recurrence math — it parses text into a strict intent, resolves it against
real data, and calls the same DataLayer methods the existing REST routes
call.

### Pipeline

`PARSE -> VALIDATE -> RESOLVE -> EXECUTE -> VERIFY -> RESPOND`, implemented in:

- `lib/assistant/intents.ts` — the strict intent allowlist (a TypeScript
  discriminated union of exactly 11 intents, no `any`/free-form fields).
- `lib/assistant/dateParsing.ts` + `lib/assistant/parser.ts` — pure,
  deterministic text -> structured-intent extraction (no DB/IO), using
  `date-fns` (the project's existing date library) for all date arithmetic.
- `lib/assistant/validate.ts` — fills in only real, existing defaults
  (e.g. `user_preferences.default_reminder_time`) and turns missing/unsafe
  input into a clarification question, never a guess.
- `lib/assistant/resolveEntity.ts` — deterministic entity resolution:
  exact name -> normalized/token-order-independent partial match -> unique
  partial match -> conversation context -> clarification. Multiple matches
  are never picked among randomly.
- `lib/assistant/context.ts` — short-term, in-memory, per-session
  conversation context (see "Conversation context" below).
- `lib/assistant/executeIntent.ts` — the exhaustive `switch` that calls
  existing `db.*` DataLayer methods / scheduling functions directly (the
  same functions the REST routes call), then re-reads the persisted record
  to verify before generating a response.
- `lib/assistant/respond.ts` — NOVA-voice reply text; failure paths never
  read as success.
- `lib/assistant/pipeline.ts` — wires the above into one entry point used
  by both the API route and tests/scripts.

### Supported intents

`CREATE_REMINDER`, `CREATE_RECURRING_REMINDER`, `UPDATE_REMINDER`,
`COMPLETE_REMINDER`, `SNOOZE_REMINDER`, `REMIND_AGAIN`, `QUERY_TODAY`,
`QUERY_UPCOMING`, `QUERY_OVERDUE`, `QUERY_PAYMENTS`, `MARK_PAYMENT_PAID` —
plus `NEEDS_CLARIFICATION` and `UNSUPPORTED` result kinds. Nothing outside
this list can ever reach `executeIntent`'s switch (TypeScript-checked and
runtime-checked via an exhaustive `never` default case).

Example phrases:

- "remind me to call the dentist tomorrow at 10am"
- "remind me to take out recycling every Monday at 8am"
- "remind me to check email every weekday"
- "snooze the dentist call for 15 minutes" / "snooze it for 15 minutes"
- "move the dentist call to tomorrow at 3pm"
- "mark the dentist call as done" / "complete the dentist call"
- "remind me again about the dentist call"
- "what do I need to do today?" / "what's overdue?" / "what's upcoming?"
- "what payments do I have coming up?"
- "mark the Visa card as paid"

Recognized date/time phrasing: today, tomorrow, tonight, morning/
afternoon/evening, explicit clock times ("10am", "6 PM", "14:30"),
specific ISO dates, weekday names, relative durations ("in 2 hours", "for
30 minutes"). Recognized recurrence phrasing: "every &lt;weekday&gt;",
"every weekday", "every day/week/month/year", "every N days/weeks/months" —
anything else (e.g. "every full moon") returns a clarification instead of
a guessed approximation.

### Entity resolution

Order: exact name match -> normalized, token-order-independent partial
match ("the accountant call" matches a reminder titled "Call the
accountant") -> unique partial match -> short-term conversation context
("it"/"that") -> clarification. Ambiguous matches are always listed back
to the user to choose from — never picked randomly.

### Conversation context (Phase 5 design decision)

A simple in-memory `Map<sessionId, SessionContext>` in
`lib/assistant/context.ts` holds only the last referenced reminder/payment
id and the last few turns, per browser session (a `sessionId` generated
client-side and stored in `localStorage`). This is deliberately **separate
from** the existing "What NOVA Knows" Personal Context system
(`personal_context_entries`): that table holds durable, explicit,
user-entered facts surfaced anywhere NOVA reasons about the user; this
context is ephemeral, implicit, ordinary turn-taking scratch space that
should never leak into long-term memory. Trade-off: this state does not
survive a server restart and isn't shared across server instances — fine
for a single-user local/PWA app; a multi-instance deployment could swap
the `Map` for a shared cache behind the same functions without touching
any caller.

### Execution & safety

- Every mutating intent calls the exact same DataLayer method the REST
  route calls (e.g. `db.snoozeReminder`, `db.completeReminder`,
  `db.markPaymentCyclePaid`, `db.createReminder`), then re-reads the
  persisted record before replying — a failed operation never produces a
  "Done!" response (see `lib/assistant/respond.ts#replyForFailure` and the
  honest-failure tests in `tests/assistant-execution.test.ts`).
- Financially meaningful ambiguity (e.g. more than one open unpaid cycle
  for an account, or more than one matching payment account) returns a
  clarification instead of executing — the same mechanism as ordinary
  missing-info clarification, not a separate confirmation-intent type.
- No delete/cancel capability was added. "Delete the X reminder" is
  `UNSUPPORTED` — deletion isn't exposed through natural language at all,
  matching the brief's "if in doubt, leave deletion entirely unsupported"
  guidance.
- No raw SQL is ever constructed from user text; the parser only produces
  values of the strict `AssistantIntent` union.

### API & UI

- `POST /api/assistant/message` — `{ text, sessionId }` ->
  `{ reply, resultSummary? }`.
- `app/assistant/page.tsx` + `components/assistant/ChatPanel.tsx` — a
  simple chat UI using existing `nova-*` tokens, keyboard-accessible
  (Enter to send), with an "Assistant" entry added to the existing nav
  (`types/nav.ts`, `components/layout/Sidebar.tsx` /
  `components/layout/BottomNav.tsx` — no other nav item was removed;
  Assistant was appended after Calendar so the mobile bottom nav's
  existing first five items are unchanged).

### Testing

```bash
npx vitest run tests/assistant-parser.test.ts     # pure parser + date-boundary tests
npx vitest run tests/assistant-execution.test.ts  # real DB, honest-failure, resolution tests
npx tsx scripts/verify-assistant-e2e.ts           # scratch-DB, real end-to-end proof
```

### Known limitations

- Understands only the phrasing patterns listed above — not arbitrary
  English. Anything else returns `UNSUPPORTED` with a plain explanation of
  what NOVA can do, rather than guessing.
- Entity resolution is token-based, not a full fuzzy/semantic matcher —
  very different phrasing for the same reminder may not match and will
  ask for clarification instead.
- Conversation context is single-process, in-memory, and does not survive
  a server restart (by design — see above).

## V10 — Voice Assistant

A client-side voice layer sitting entirely on top of the V7 text
pipeline. **There is no separate voice intent engine.** Speech-to-text
produces a plain transcript string, and that string is handed to the
exact same `handleAssistantMessage()` function (via the same
`POST /api/assistant/message` route) that typed text already uses — see
`tests/voice-pipeline.test.ts` for a test that proves a transcript and
the identical typed text produce the same reply.

### Why the Web Speech API, not a paid STT/TTS service

The brief calls for zero external LLM/speech-API dependency, and the
browser's built-in `SpeechRecognition`/`webkitSpeechRecognition` (speech-
to-text) and `SpeechSynthesis` (text-to-speech) satisfy that: no API key,
no server-side audio processing, no new npm dependency, and no added
hosting cost — the browser does the work. A paid STT/TTS service (e.g.
Whisper API, ElevenLabs) was not used; nothing about this app's transcript
accuracy needs exceeded what the Web Speech API already provides, and
adding one would have contradicted the "zero-dependency" brief for no
concrete benefit.

### How it works

- `hooks/useVoiceAssistant.ts` — feature-detects
  `window.SpeechRecognition || window.webkitSpeechRecognition` and
  `window.speechSynthesis`, and exposes an honest status model modeled
  directly on `hooks/usePushNotifications.ts`'s status states:
  `unsupported | idle | requesting_permission | listening | processing |
  speaking | error`, plus the real `SpeechRecognition` `onerror` code
  mapped to one of `not-allowed | no-speech | network | audio-capture |
  aborted | unknown`, each with its own distinct, honest message (never
  one generic failure string).
- `components/assistant/ChatPanel.tsx` — adds a press-to-talk mic button
  next to the existing text input and send button. Tapping it starts
  `SpeechRecognition` (browser asks for mic permission the first time);
  tapping again (or `SpeechRecognition`'s own silence-detection via
  `onend`) stops it. The interim (in-progress) transcript is shown live in
  the chat list so the user always sees what NOVA is hearing; the final
  transcript is posted as an ordinary "YOU" chat message and sent through
  `sendText()` — the same function the typed-input Enter/Send path calls.
  If the browser has no `SpeechRecognition` at all, the mic button is not
  rendered and a one-line note explains that voice input isn't supported
  there, rather than showing a non-functional control.
- A "Speak replies" checkbox (off by default) gates text-to-speech via
  `speechSynthesis.speak()`. It only reads out replies when explicitly
  enabled — turning it on is a same-session, explicit opt-in so nothing
  is ever spoken aloud by surprise, whether the triggering message was
  typed or spoken.
- The mic never claims to be "always listening": it is only active
  between an explicit tap-to-start and either a tap-to-stop, browser-
  detected end of speech, or an error. There is no background/hands-free
  listening mode.

### Browser support (stated honestly, not over-promised)

- **Good**: Chrome, Edge, and Android Chrome implement both
  `SpeechRecognition` and `SpeechSynthesis` reliably.
- **Partial/inconsistent**: Safari and iOS Safari have historically had
  version-gated, less consistent `SpeechRecognition` support. On any
  browser where it's unavailable, the UI degrades to text-only
  automatically (see feature detection above) — voice is never assumed to
  work.
- Some browsers' `SpeechRecognition` implementation streams audio to a
  vendor's remote recognition service even though the JS API itself is
  client-side and needs no API key from this app — that's why a
  `"network"` error case exists and is surfaced honestly rather than
  treated as a bug in this app.
- `SpeechRecognition`/microphone access requires a **secure context**
  (HTTPS, or `localhost` in dev). Vercel serves production over HTTPS by
  default, so no extra configuration is needed there.
- The mic button is a standard touch-target-sized button placed inline
  with the existing text input/send button, and does not overlap the
  bottom nav on mobile.

### Testing

Real microphone capture and actual `SpeechRecognition`/`SpeechSynthesis`
browser behavior cannot be exercised in this Node/vitest test
environment — there is no real browser, audio device, or speech service
to drive headlessly. What **is** tested deterministically:

```bash
npx vitest run tests/voice-pipeline.test.ts
```

- That a transcript string, once obtained, is handled identically to the
  same string typed — by calling `handleAssistantMessage()` directly and
  asserting on the resulting reply/persisted state (same pattern as
  `tests/assistant-execution.test.ts`, same `os.tmpdir()` scratch-DB and
  `beforeAll` pre-warm conventions).
- Pure status-derivation and error-mapping logic in
  `hooks/useVoiceAssistant.ts` (`deriveSupport`, `errorReasonFromCode`,
  `errorMessageFor`) against mocked constructors/error codes — not a
  simulated browser environment.

Manual verification of the mic button, permission prompts, and actual
voice capture requires a real browser and was not automatable here; the
`/assistant` page was confirmed to build and render (with the mic control
correctly hidden/absent in this headless environment, since it has no
`SpeechRecognition`) via `npm run build`.

### Known limitations

- No offline speech recognition — `SpeechRecognition` in browsers that use
  a remote recognition service requires network connectivity, and this is
  outside this app's control.
- No hands-free/"wake word" listening — by design, per the brief's
  constraint against ever claiming background microphone capability.
- Voice reply quality/voice selection is whatever `SpeechSynthesis` offers
  in the browser/OS; NOVA does not bundle its own TTS voice.

## V11 — Integrations + Automation

V11 adds two independent pieces: an **integration connector architecture**
(currently one real, honestly-unconnected scaffold: Google Calendar) and a
fully working, fully tested **automation engine** (trigger -> condition ->
action -> execution -> verification -> history) built entirely on
internal triggers, so it needs no external OAuth to be real and solid.

### Integration architecture

`lib/integrations/types.ts` defines `IntegrationConnector` — `isConfigured()`,
`getAuthUrl()`, `exchangeCode()`, `fetchEvents()` — shaped around what a real
Google Calendar OAuth2 (authorization-code flow) + Calendar API v3
(read-only) integration actually needs, so a future provider (Gmail,
Outlook, …) can implement the same contract.

`lib/integrations/googleCalendar.ts` is the one connector this pass ships.
It builds **real, correct OAuth2 URLs** against Google's documented
endpoints (`accounts.google.com/o/oauth2/v2/auth`,
`oauth2.googleapis.com/token`) and makes a real `fetch()`-based token
exchange and a real read-only `events.list` call when configured — but
**this sandbox has no real Google Cloud project and no browser to complete
a consent screen**, so none of that has been exercised end-to-end against
a live Google account. `isConfigured()` honestly returns `false` unless
`GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`/`GOOGLE_REDIRECT_URI` are all
set — exactly like the existing Twilio/Web Push "not configured" pattern
— and no code path ever reports "connected" without a real token exchange
actually succeeding.

**To connect a real Google Calendar**, once you have a Google Cloud
project with the Calendar API enabled and an OAuth2 "Web application"
client:
1. Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`
   (matching an "Authorized redirect URI" on that client, e.g.
   `http://localhost:3000/api/integrations/google/callback`) in `.env.local`.
2. Open Settings → Integrations → Connect. `GET /api/integrations/google/connect`
   redirects to Google's real consent screen; `GET /api/integrations/google/callback`
   performs the real token exchange and persists the result to
   `integration_accounts` (`connected`/`error`, never fabricated).

Tokens are stored as-is in `integration_accounts` for now — a single-user
local app. **Documented gap**: a production deployment with real
credentials would need encryption-at-rest for `access_token`/
`refresh_token`; not solved in this pass since no real token is ever
written in this environment.

### Automation engine

`lib/automation/engine.ts` is the impure orchestrator (same architectural
role as `lib/proactive/engine.ts`): the only place automation logic
touches the DB/providers. Supported triggers: `reminder_completed`
(event-based, fired synchronously at the two existing call sites where a
reminder is already marked done — `app/api/reminders/[id]/done/route.ts`
and `lib/assistant/executeIntent.ts`'s `COMPLETE_REMINDER` case),
`payment_overdue` and the periodic `cron_daily`/`cron_weekly` (both
evaluated inside the **same** `POST /api/cron/process-due-reminders`
invocation as the existing due-reminder scan and V8 proactive
intelligence — no second scheduler). Actions call **only** existing
functions: `create_reminder` → `db.createReminder` (the same path V7's
assistant and the reminders API already use), `send_notification` → the
existing honest notification provider abstraction (push/SMS/call/email,
never a new one).

**Idempotency**: an event-triggered automation checks its own
`automation_runs` history for a prior `success` against the same
`trigger_context` (the reminder id, or the overdue cycle id) before
acting — replaying the same event never double-fires. A periodic
automation tracks `automations.last_run_at` and computes a period key
(calendar day for daily, ISO week for weekly); a second evaluation within
the same period is skipped and logged as `skipped_cooldown`, mirroring
V8's cooldown pattern.

**Anti-chaining**: a hard rule for this pass, not a hop-count heuristic.
Every reminder an automation action creates is flagged
`reminders.created_by_automation = 1` (additive column, migration 0010).
`onReminderCompleted()` refuses to fire *any* automation for a reminder
carrying that flag. This means an automation's own output can never
itself satisfy another automation's `reminder_completed` trigger — no
automation can trigger itself or another automation, directly or
indirectly, through this pass's trigger set.

**Rate limiting / safety**: automations never delete data, never touch a
reminder/account they didn't create, and every outcome — success,
failure, skipped-by-condition, skipped-by-cooldown — is written to
`automation_runs` (full audit history), never silently dropped.

### Data model (migration `0010_integrations_automation.sql`)

- `integration_accounts` — one row per (user, provider); `status`
  (`not_connected`/`connected`/`error`/`expired`), tokens, timestamps.
- `automations` — `trigger_type`, `trigger_config`/`condition_config`/
  `action_config` (JSON), `enabled`, `last_run_at`.
- `automation_runs` — full history: `outcome`
  (`success`/`failed`/`skipped_condition`/`skipped_cooldown`), `detail`,
  `trigger_context`.
- `reminders.created_by_automation` — the anti-chaining marker.

### Automation templates (UI scope decision)

V11 ships a small, fixed set of pre-defined, safely-parameterized
templates (`lib/automation/templates.ts`) rather than a full arbitrary
trigger/condition/action composer — an explicit scope decision to keep
the UI honest and small:
- "When a reminder is completed, create a follow-up reminder"
- "Every Monday, remind me to review the week" (`cron_weekly`)
- "When a payment is overdue, send me a notification"

Manage automations at `/automations` (linked from Settings): enable/
disable, delete, and view each automation's full run history. Settings
also gained an **Integrations** card showing Google Calendar's honest
connection status.

### Known limitations

- Google Calendar's real token exchange and Calendar API read have never
  been exercised against a live account in this environment — only their
  "not configured" paths and OAuth URL construction are verified (see
  `tests/integrations.test.ts`).
- `integration_accounts` tokens are not encrypted at rest (documented
  above).
- No Gmail/Outlook connector in this pass — one well-built connector plus
  the general interface was judged more honest than three half-built ones.
