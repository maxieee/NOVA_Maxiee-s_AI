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
