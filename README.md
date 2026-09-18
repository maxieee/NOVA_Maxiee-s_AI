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
  notifications/         Notification message builders
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

## Architecture Decisions

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
