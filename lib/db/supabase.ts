/* eslint-disable @typescript-eslint/no-explicit-any -- raw pg rows are untyped by design, same convention as lib/db/local.ts */
import { Pool, type PoolClient } from "pg";
import { newId } from "@/lib/utils/id";
import type { DataLayer, ReminderFilter, AnalyticsSnapshot } from "./types";
import type {
  Reminder,
  ReminderInput,
  ReminderOccurrence,
  ReminderHistoryEntry,
  ReminderTypeKey,
  UserPreferences,
  UserPreferencesUpdate,
  PaymentDetails,
  CallDetails,
  MeetingDetails,
  FollowUpDetails,
  RecurrenceRule,
  PersonalContextEntry,
  MemorySource,
  NotificationChannel,
  NotificationOutcome,
  PushSubscriptionRecord,
  PaymentAccount,
  PaymentAccountInput,
  PaymentAccountUpdate,
  PaymentCycle,
  ProactiveNotificationRecord,
  ProactiveNotificationOutcome,
  IntegrationAccountRecord,
  IntegrationProvider,
  IntegrationStatus,
  AutomationRecord,
  AutomationInput,
  AutomationRunRecord,
  AutomationRunOutcome,
  AnalyticsRecommendationRecord,
  AnalyticsRecommendationStatus,
  NotificationLogEntry,
} from "@/types/reminder";

/**
 * Real Postgres/Supabase DataLayer.
 *
 * CLIENT CHOICE: raw `pg` (node-postgres), not `@supabase/supabase-js`'s
 * query builder. lib/db/local.ts is written throughout as hand-rolled SQL
 * with joins, IN(...) lists, computed columns and multi-statement
 * transactions (see rowToReminder, getAnalyticsSnapshot, createReminder).
 * Porting that faithfully to a query-builder's .from().select() paradigm
 * would require re-expressing every one of those queries in a different
 * shape, risking behavioral drift from the audited SQLite implementation.
 * `pg` lets each query be ported near-verbatim (just `?` -> `$1, $2, ...`
 * and sync -> async/await), which is the safer, lower-drift choice for a
 * persistence-layer swap that must not change behavior. This connects
 * directly via the Postgres wire protocol (using SUPABASE credentials as
 * a Postgres connection), which works identically against Supabase or any
 * other Postgres instance (e.g. the local one used to verify this file).
 *
 * CONNECTION POOLING: a single module-level `Pool` is created lazily and
 * reused for the lifetime of the process/lambda container, matching the
 * standard pattern for serverless Postgres access (Vercel functions reuse
 * a warm container's module scope between invocations, so the pool is not
 * recreated per request; a cold start creates exactly one new pool). Pool
 * size is kept small (default 5) since a serverless function should hold
 * few concurrent connections per instance.
 *
 * REQUIRED IN PRODUCTION: DATABASE_URL must point at Supabase's
 * **Transaction Pooler** (Supavisor "Transaction" mode, the connection
 * string using port 6543), NOT the Session Pooler (port 5432) and NOT the
 * direct connection string. This isn't just a performance suggestion —
 * using the Session Pooler in production caused a real incident
 * (`EMAXCONNSESSION: max clients reached in session mode`): Next.js on
 * Vercel runs each route as its own serverless function, so under any
 * concurrent traffic (e.g. several /reminders/[id] page loads at once)
 * multiple separate lambda instances can be warm simultaneously, each with
 * its OWN independent `Pool` of up to NOVA_PG_POOL_MAX connections. Session
 * mode reserves one dedicated Postgres backend connection per client
 * connection for its *entire* lifetime (not just per-query/transaction),
 * so those pools' connections accumulate across concurrently-warm
 * instances and can exhaust the project's session-pooler connection quota
 * under bursty concurrent load — exactly what happened here. Transaction
 * mode instead multiplexes many client-side "connections" onto a much
 * smaller set of real backend connections, handing one back to the shared
 * pool as soon as each transaction/statement finishes, which is what
 * serverless's many-short-lived-connections access pattern actually needs.
 *
 * COMPATIBILITY (verified, not assumed): this file's `pg` usage was
 * audited against Transaction pooler's constraints and needs no code
 * changes. `withTx()` below acquires exactly one `PoolClient` via
 * `pool.connect()` for a BEGIN...COMMIT/ROLLBACK sequence and releases it
 * once, immediately after — it never holds a transaction open across
 * unrelated work or spans one transaction across multiple separately
 * acquired connections, which is exactly the discipline transaction-mode
 * pooling requires. Every other call site queries via `getPool()` directly
 * (an implicit single-statement acquire+release per call). Nothing in this
 * file uses session-scoped Postgres features that transaction pooling
 * cannot support (no `LISTEN`/`NOTIFY`, no advisory locks, no session-level
 * `SET`, no named/reused prepared statements) — confirmed by inspection of
 * every `exec`/`one`/`many` call in this file.
 */

let pool: Pool | null = null;

function getPool(): Pool {
  if (pool) return pool;

  const connectionString =
    process.env.DATABASE_URL ??
    process.env.SUPABASE_DB_URL ??
    buildConnectionStringFromSupabaseEnv();

  if (!connectionString) {
    throw new Error(
      "No Postgres connection configured. Set DATABASE_URL (or SUPABASE_DB_URL) to a Postgres " +
        "connection string, or set NOVA_DATA_SOURCE=local to use the bundled SQLite data layer."
    );
  }

  pool = new Pool({
    connectionString,
    max: Number(process.env.NOVA_PG_POOL_MAX ?? 5),
    idleTimeoutMillis: 30_000,
    ssl: process.env.NOVA_PG_SSL === "false" ? undefined : { rejectUnauthorized: false },
  });
  return pool;
}

/**
 * Supabase project URLs (https://xyz.supabase.co) are NOT themselves a
 * Postgres connection string — they are the REST/Auth API host. There is
 * no generically derivable Postgres host from NEXT_PUBLIC_SUPABASE_URL
 * alone (Supabase's Postgres host follows a project-specific convention
 * that isn't guaranteed stable to construct client-side), so this app
 * requires DATABASE_URL (the connection string from Supabase's own
 * Project Settings > Database page) to be set explicitly rather than
 * guessing one. This function exists only as a documented "no" so the
 * error message above is accurate about what NOVA actually needs.
 */
function buildConnectionStringFromSupabaseEnv(): string | null {
  return null;
}

async function withTx<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

type Queryable = Pick<PoolClient, "query">;

async function one<T = any>(q: Queryable, sql: string, params: unknown[] = []): Promise<T | undefined> {
  const res = await q.query(sql, params);
  return res.rows[0] as T | undefined;
}

async function many<T = any>(q: Queryable, sql: string, params: unknown[] = []): Promise<T[]> {
  const res = await q.query(sql, params);
  return res.rows as T[];
}

async function exec(q: Queryable, sql: string, params: unknown[] = []): Promise<void> {
  await q.query(sql, params);
}

async function rowToReminder(q: Queryable, row: any): Promise<Reminder> {
  const typeRows = await many<{ key: ReminderTypeKey }>(
    q,
    `select rt.key from reminder_type_assignments a
     join reminder_types rt on rt.id = a.reminder_type_id
     where a.reminder_id = $1`,
    [row.id]
  );
  const types = typeRows.map((t) => t.key);

  let payment: PaymentDetails | null = null;
  if (types.includes("payment")) {
    const p = await one<any>(q, `select * from payment_details where reminder_id = $1`, [row.id]);
    if (p) {
      payment = {
        id: p.reminder_id,
        reminder_id: p.reminder_id,
        amount: Number(p.amount),
        currency: p.currency,
        payee: p.payee,
        account_last4: p.account_last4,
        category: p.category,
        billing_date: toDateStr(p.billing_date),
        due_date: toDateStr(p.due_date) as string,
        autopay: !!p.autopay,
        paid_status: p.paid_status,
      };
    }
  }

  let call: CallDetails | null = null;
  if (types.includes("call")) {
    const c = await one<any>(q, `select * from call_details where reminder_id = $1`, [row.id]);
    if (c) call = { contact_name: c.contact_name, phone_number: c.phone_number ?? undefined };
  }

  let meeting: MeetingDetails | null = null;
  if (types.includes("meeting")) {
    const m = await one<any>(q, `select * from meeting_details where reminder_id = $1`, [row.id]);
    if (m) {
      meeting = {
        location: m.location ?? undefined,
        meeting_link: m.meeting_link ?? undefined,
        attendees: m.attendees ?? [],
      };
    }
  }

  let followUp: FollowUpDetails | null = null;
  if (types.includes("follow_up")) {
    const f = await one<any>(q, `select * from follow_up_details where reminder_id = $1`, [row.id]);
    if (f) followUp = { related_to: f.related_to ?? undefined, last_contacted_at: toDateStr(f.last_contacted_at) };
  }

  let recurrence: RecurrenceRule | null = null;
  if (types.includes("recurring")) {
    const r = await one<any>(q, `select * from recurrence_rules where reminder_id = $1`, [row.id]);
    if (r) {
      recurrence = {
        id: r.id,
        reminder_id: r.reminder_id,
        frequency: r.frequency,
        interval: r.interval,
        by_day_of_month: r.by_day_of_month,
        by_month: r.by_month,
        by_weekday: r.by_weekday ?? null,
        ends_at: toDateStr(r.ends_at),
        occurrences_limit: r.occurrences_limit,
      };
    }
  }

  const nextOcc = await one<{ scheduled_for: Date }>(
    q,
    `select scheduled_for from reminder_occurrences
     where reminder_id = $1 and status in ('pending','fired')
     order by scheduled_for asc limit 1`,
    [row.id]
  );

  const channelRows = await many<{ channel: NotificationChannel }>(
    q,
    `select channel from reminder_notification_channels where reminder_id = $1`,
    [row.id]
  );

  return {
    id: row.id,
    user_id: row.user_id,
    title: row.title,
    description: row.description,
    date: toDateStr(row.date) as string,
    time: toTimeStr(row.time),
    priority: row.priority,
    notes: row.notes,
    status: row.status,
    created_at: toISO(row.created_at) as string,
    updated_at: toISO(row.updated_at) as string,
    completed_at: toISO(row.completed_at),
    types,
    payment,
    call,
    meeting,
    follow_up: followUp,
    recurrence,
    next_occurrence: nextOcc ? toISO(nextOcc.scheduled_for) : null,
    channels: channelRows.map((c) => c.channel),
    intensity: row.intensity ?? "normal",
  };
}

// --- pg <-> app value shaping ---------------------------------------------
// node-postgres returns `date`/`timestamptz` columns as JS Date objects and
// `numeric` as strings by default. The app's TypeScript types (and its
// date-parsing code, e.g. lib/scheduling/*) expect ISO 8601 strings
// (date-only "YYYY-MM-DD", "HH:MM[:SS]" for time, full ISO timestamps for
// timestamptz) exactly like SQLite's local.ts produces, so every read path
// normalizes back to those shapes here.
function toISO(v: unknown): string | null {
  if (v == null) return null;
  if (v instanceof Date) return v.toISOString();
  return String(v);
}
function toDateStr(v: unknown): string | null {
  if (v == null) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v);
}
function toTimeStr(v: unknown): string | null {
  if (v == null) return null;
  // pg returns `time` columns as "HH:MM:SS" strings already.
  return String(v).slice(0, 5) === String(v) ? String(v) : String(v).slice(0, 8);
}

class SupabaseDataLayer implements DataLayer {
  async getCurrentUserId() {
    const row = await one<{ id: string }>(getPool(), `select id from users order by created_at asc limit 1`);
    if (!row) {
      throw new Error(
        "No user row found in the Postgres database. Run database/migrations/*.sql (0001-0012) " +
          "against it and seed at least one row in `users` before using NOVA_DATA_SOURCE=supabase."
      );
    }
    return row.id;
  }

  async getPreferences(userId: string) {
    const row = await one<any>(getPool(), `select * from user_preferences where user_id = $1`, [userId]);
    const user = await one<any>(getPool(), `select display_name from users where id = $1`, [userId]);
    const channelRows = await many<{ channel: NotificationChannel }>(
      getPool(),
      `select channel from user_preferred_channels where user_id = $1`,
      [userId]
    );
    return {
      user_id: userId,
      display_name: user?.display_name ?? "You",
      reminder_lead_days: row ? (row.reminder_lead_days as number[]) : [7, 3, 1],
      repeat_interval_minutes: row?.repeat_interval_minutes ?? 120,
      escalation_enabled: row ? !!row.escalation_enabled : true,
      theme: row?.theme ?? "dark",
      preferred_name: row?.preferred_name ?? null,
      nova_should_call_user: row?.nova_should_call_user ?? null,
      default_reminder_time: toTimeStr(row?.default_reminder_time) ?? "09:00",
      default_snooze_minutes: row?.default_snooze_minutes ?? 15,
      default_notification_behavior: row?.default_notification_behavior ?? "notify_once",
      timezone: row?.timezone ?? "UTC",
      quiet_hours_start: toTimeStr(row?.quiet_hours_start),
      quiet_hours_end: toTimeStr(row?.quiet_hours_end),
      default_intensity: row?.default_intensity ?? "normal",
      repeat_ignored_reminders: row ? !!row.repeat_ignored_reminders : true,
      escalate_urgent_reminders: row ? !!row.escalate_urgent_reminders : true,
      preferred_channels: channelRows.map((c) => c.channel),
      max_follow_up_attempts: row?.max_follow_up_attempts ?? 8,
      escalation_threshold_repeats: row?.escalation_threshold_repeats ?? 3,
      phone_number: row?.phone_number ?? null,
      proactive_intelligence_enabled: row ? !!row.proactive_intelligence_enabled : true,
    } satisfies UserPreferences;
  }

  async updatePreferences(userId: string, update: UserPreferencesUpdate) {
    await withTx(async (client) => {
      const now = new Date().toISOString();
      const existing = await one(client, `select user_id from user_preferences where user_id = $1`, [userId]);
      if (!existing) {
        await exec(client, `insert into user_preferences (user_id, updated_at) values ($1, $2)`, [userId, now]);
      }

      const columnMap: Record<string, string> = {
        reminder_lead_days: "reminder_lead_days",
        repeat_interval_minutes: "repeat_interval_minutes",
        escalation_enabled: "escalation_enabled",
        theme: "theme",
        preferred_name: "preferred_name",
        nova_should_call_user: "nova_should_call_user",
        default_reminder_time: "default_reminder_time",
        default_snooze_minutes: "default_snooze_minutes",
        default_notification_behavior: "default_notification_behavior",
        timezone: "timezone",
        quiet_hours_start: "quiet_hours_start",
        quiet_hours_end: "quiet_hours_end",
        default_intensity: "default_intensity",
        repeat_ignored_reminders: "repeat_ignored_reminders",
        escalate_urgent_reminders: "escalate_urgent_reminders",
        max_follow_up_attempts: "max_follow_up_attempts",
        escalation_threshold_repeats: "escalation_threshold_repeats",
        phone_number: "phone_number",
        proactive_intelligence_enabled: "proactive_intelligence_enabled",
      };

      const sets: string[] = [];
      const params: unknown[] = [];
      for (const [key, column] of Object.entries(columnMap)) {
        if (!(key in update)) continue;
        const value = (update as Record<string, unknown>)[key];
        // reminder_lead_days is a real Postgres int[] column (unlike
        // SQLite's JSON-text mirror) — pass the array directly.
        params.push(value);
        sets.push(`${column} = $${params.length}`);
      }

      if (sets.length) {
        params.push(now);
        const updatedAtIdx = params.length;
        params.push(userId);
        await exec(
          client,
          `update user_preferences set ${sets.join(", ")}, updated_at = $${updatedAtIdx} where user_id = $${params.length}`,
          params
        );
      } else {
        await exec(client, `update user_preferences set updated_at = $1 where user_id = $2`, [now, userId]);
      }

      if (update.preferred_channels) {
        await exec(client, `delete from user_preferred_channels where user_id = $1`, [userId]);
        for (const channel of update.preferred_channels) {
          await exec(
            client,
            `insert into user_preferred_channels (user_id, channel) values ($1, $2) on conflict do nothing`,
            [userId, channel]
          );
        }
      }
    });
    // Read back AFTER the transaction commits — reading via getPool()
    // (a separate connection from the pool) from INSIDE the transaction
    // would see pre-commit state and could return stale values.
    return this.getPreferences(userId);
  }

  private rowToPersonalContext(row: Record<string, unknown>): PersonalContextEntry {
    return {
      ...(row as Omit<PersonalContextEntry, "active" | "created_at" | "updated_at">),
      active: !!row.active,
      created_at: toISO(row.created_at) as string,
      updated_at: toISO(row.updated_at) as string,
    } as PersonalContextEntry;
  }

  async listPersonalContext(userId: string, options?: { includeInactive?: boolean }) {
    const rows = options?.includeInactive
      ? await many<any>(getPool(), `select * from personal_context_entries where user_id = $1 order by created_at desc`, [userId])
      : await many<any>(
          getPool(),
          `select * from personal_context_entries where user_id = $1 and active = true order by created_at desc`,
          [userId]
        );
    return rows.map((r) => this.rowToPersonalContext(r));
  }

  async addPersonalContext(
    userId: string,
    entry: { category?: string; label: string; value: string; source?: MemorySource }
  ) {
    const id = newId();
    const now = new Date().toISOString();
    await exec(
      getPool(),
      `insert into personal_context_entries (id, user_id, category, label, value, source, active, created_at, updated_at)
       values ($1, $2, $3, $4, $5, $6, true, $7, $7)`,
      [id, userId, entry.category ?? "general", entry.label, entry.value, entry.source ?? "user_entered", now]
    );
    const row = await one<any>(getPool(), `select * from personal_context_entries where id = $1`, [id]);
    return this.rowToPersonalContext(row!);
  }

  async updatePersonalContext(
    id: string,
    changes: { category?: string; label?: string; value?: string; active?: boolean }
  ) {
    const existing = await one<any>(getPool(), `select * from personal_context_entries where id = $1`, [id]);
    if (!existing) return null;
    const now = new Date().toISOString();
    await exec(
      getPool(),
      `update personal_context_entries set category = $1, label = $2, value = $3, active = $4, updated_at = $5 where id = $6`,
      [
        changes.category ?? existing.category,
        changes.label ?? existing.label,
        changes.value ?? existing.value,
        changes.active === undefined ? existing.active : changes.active,
        now,
        id,
      ]
    );
    const row = await one<any>(getPool(), `select * from personal_context_entries where id = $1`, [id]);
    return this.rowToPersonalContext(row!);
  }

  async deletePersonalContext(id: string) {
    await exec(getPool(), `delete from personal_context_entries where id = $1`, [id]);
  }

  async logNotification(args: {
    reminderId: string;
    occurrenceId: string;
    channel: NotificationChannel | "in_app";
    message: string;
    outcome: NotificationOutcome;
    attemptNumber?: number;
    escalationLevel?: number;
    providerRef?: string | null;
  }) {
    await withTx(async (client) => {
      const now = new Date().toISOString();
      await exec(
        client,
        `insert into notifications (id, reminder_id, occurrence_id, sent_at, channel, message, outcome, attempt_number, escalation_level, provider_ref)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          newId(),
          args.reminderId,
          args.occurrenceId,
          now,
          args.channel,
          args.message,
          args.outcome,
          args.attemptNumber ?? 1,
          args.escalationLevel ?? 0,
          args.providerRef ?? null,
        ]
      );
      const action = (args.escalationLevel ?? 0) > 0 ? "escalated" : "notified";
      await exec(
        client,
        `insert into reminder_history (id, reminder_id, action, detail, created_at, occurrence_id) values ($1, $2, $3, $4, $5, $6)`,
        [
          newId(),
          args.reminderId,
          action,
          `${args.channel}: ${args.outcome} (attempt ${args.attemptNumber ?? 1})`,
          now,
          args.occurrenceId,
        ]
      );
    });
  }

  async listNotifications(reminderId: string) {
    const rows = await many<any>(
      getPool(),
      `select * from notifications where reminder_id = $1 order by sent_at desc`,
      [reminderId]
    );
    return rows.map((r) => ({ ...r, sent_at: toISO(r.sent_at) })) as NotificationLogEntry[];
  }

  async listReminders(userId: string, filter?: ReminderFilter) {
    const rows = await many<any>(
      getPool(),
      `select * from reminders where user_id = $1 order by date asc, time asc`,
      [userId]
    );

    let reminders = await Promise.all(rows.map((r) => rowToReminder(getPool(), r)));

    if (filter?.types?.length) {
      reminders = reminders.filter((r) => filter.types!.some((t) => r.types.includes(t)));
    }
    if (filter?.status?.length) {
      reminders = reminders.filter((r) => filter.status!.includes(r.status));
    }
    if (filter?.search) {
      const q = filter.search.toLowerCase();
      reminders = reminders.filter(
        (r) => r.title.toLowerCase().includes(q) || (r.description ?? "").toLowerCase().includes(q)
      );
    }

    return reminders;
  }

  async getReminder(id: string) {
    const row = await one<any>(getPool(), `select * from reminders where id = $1`, [id]);
    if (!row) return null;
    return rowToReminder(getPool(), row);
  }

  async createReminder(userId: string, input: ReminderInput) {
    const id = newId();
    const now = new Date().toISOString();

    await withTx(async (client) => {
      await exec(
        client,
        `insert into reminders (id, user_id, title, description, date, time, priority, notes, status, intensity, created_by_automation, created_at, updated_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, 'scheduled', $9, $10, $11, $11)`,
        [
          id,
          userId,
          input.title,
          input.description ?? null,
          input.date,
          input.time ?? null,
          input.priority,
          input.notes ?? null,
          input.intensity ?? "normal",
          !!input.createdByAutomation,
          now,
        ]
      );

      for (const channel of input.channels ?? []) {
        await exec(
          client,
          `insert into reminder_notification_channels (reminder_id, channel) values ($1, $2) on conflict do nothing`,
          [id, channel]
        );
      }

      for (const typeKey of input.types) {
        const typeRow = await one<{ id: string }>(client, `select id from reminder_types where key = $1`, [typeKey]);
        if (!typeRow) continue;
        await exec(
          client,
          `insert into reminder_type_assignments (reminder_id, reminder_type_id) values ($1, $2) on conflict do nothing`,
          [id, typeRow.id]
        );
      }

      if (input.types.includes("payment") && input.payment) {
        await exec(
          client,
          `insert into payment_details (reminder_id, amount, currency, payee, account_last4, category, billing_date, due_date, autopay, paid_status)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'unpaid')`,
          [
            id,
            input.payment.amount ?? 0,
            input.payment.currency ?? "USD",
            input.payment.payee ?? null,
            input.payment.account_last4 ?? null,
            input.payment.category ?? "other",
            input.payment.billing_date ?? null,
            input.payment.due_date ?? input.date,
            !!input.payment.autopay,
          ]
        );
      }

      if (input.types.includes("call") && input.call) {
        await exec(client, `insert into call_details (reminder_id, contact_name, phone_number) values ($1, $2, $3)`, [
          id,
          input.call.contact_name,
          input.call.phone_number ?? null,
        ]);
      }

      if (input.types.includes("meeting") && input.meeting) {
        await exec(
          client,
          `insert into meeting_details (reminder_id, location, meeting_link, attendees) values ($1, $2, $3, $4)`,
          [id, input.meeting.location ?? null, input.meeting.meeting_link ?? null, input.meeting.attendees ?? []]
        );
      }

      if (input.types.includes("follow_up") && input.follow_up) {
        await exec(
          client,
          `insert into follow_up_details (reminder_id, related_to, last_contacted_at) values ($1, $2, $3)`,
          [id, input.follow_up.related_to ?? null, input.follow_up.last_contacted_at ?? null]
        );
      }

      if (input.types.includes("recurring") && input.recurrence) {
        await exec(
          client,
          `insert into recurrence_rules (id, reminder_id, frequency, interval, by_day_of_month, by_month, by_weekday, ends_at, occurrences_limit)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            newId(),
            id,
            input.recurrence.frequency ?? "monthly",
            input.recurrence.interval ?? 1,
            input.recurrence.by_day_of_month ?? null,
            input.recurrence.by_month ?? null,
            input.recurrence.by_weekday ?? null,
            input.recurrence.ends_at ?? null,
            input.recurrence.occurrences_limit ?? null,
          ]
        );
      }

      const scheduledFor = `${input.date}T${input.time ?? "09:00"}:00`;
      await exec(
        client,
        `insert into reminder_occurrences (id, reminder_id, scheduled_for, status) values ($1, $2, $3, 'pending')`,
        [newId(), id, scheduledFor]
      );

      await exec(
        client,
        `insert into reminder_history (id, reminder_id, action, detail, created_at) values ($1, $2, 'created', $3, $4)`,
        [newId(), id, `Created with types: ${input.types.join(", ")}`, now]
      );
    });

    return (await this.getReminder(id))!;
  }

  async updateReminderStatus(id: string, status: Reminder["status"]) {
    const now = new Date().toISOString();
    if (status === "completed") {
      await exec(getPool(), `update reminders set status = $1, updated_at = $2 where id = $3`, [status, now, id]);
    } else {
      await exec(getPool(), `update reminders set status = $1, completed_at = null, updated_at = $2 where id = $3`, [
        status,
        now,
        id,
      ]);
    }
  }

  async rescheduleReminder(id: string, date: string, time: string | null) {
    await exec(getPool(), `update reminders set date = $1, time = $2, updated_at = $3 where id = $4`, [
      date,
      time,
      new Date().toISOString(),
      id,
    ]);
  }

  async completeReminder(id: string) {
    const now = new Date().toISOString();
    await withTx(async (client) => {
      await exec(client, `update reminders set status = 'completed', completed_at = $1, updated_at = $1 where id = $2`, [
        now,
        id,
      ]);
      await exec(
        client,
        `update reminder_occurrences set status = 'acknowledged' where reminder_id = $1 and status in ('pending','fired')`,
        [id]
      );
      // DONE must immediately stop all future follow-up for every occurrence
      // of this reminder — not just the currently-firing one.
      await exec(
        client,
        `update reminder_occurrences
         set follow_up_state = 'completed', next_follow_up_at = null
         where reminder_id = $1 and follow_up_state not in ('completed','cancelled')`,
        [id]
      );
      await exec(
        client,
        `insert into reminder_history (id, reminder_id, action, detail, created_at) values ($1, $2, 'completed', null, $3)`,
        [newId(), id, now]
      );
    });
    return this.getReminder(id);
  }

  async snoozeReminder(id: string, minutes: number) {
    const now = new Date();
    const nextFire = new Date(now.getTime() + minutes * 60_000).toISOString();

    await withTx(async (client) => {
      await exec(client, `update reminders set status = 'snoozed', updated_at = $1 where id = $2`, [
        now.toISOString(),
        id,
      ]);
      // Snooze stops the CURRENT follow-up sequence...
      await exec(
        client,
        `update reminder_occurrences
         set status = 'cancelled', follow_up_state = 'cancelled', next_follow_up_at = null
         where reminder_id = $1 and status = 'pending'`,
        [id]
      );
      // ...and creates a fresh occurrence at the new time with an
      // independent, un-notified follow-up lifecycle (attempt count 0).
      await exec(
        client,
        `insert into reminder_occurrences (id, reminder_id, scheduled_for, status, follow_up_state) values ($1, $2, $3, 'pending', 'pending')`,
        [newId(), id, nextFire]
      );
      await exec(
        client,
        `insert into reminder_history (id, reminder_id, action, detail, created_at) values ($1, $2, 'snoozed', $3, $4)`,
        [newId(), id, `Snoozed ${minutes}m`, now.toISOString()]
      );
    });
    return this.getReminder(id);
  }

  async listOccurrences(reminderId: string) {
    const rows = await many<any>(
      getPool(),
      `select * from reminder_occurrences where reminder_id = $1 order by scheduled_for asc`,
      [reminderId]
    );
    return rows.map((r) => rowToOccurrence(r));
  }

  async listUpcomingOccurrences(userId: string) {
    const rows = await many<any>(
      getPool(),
      `select o.* from reminder_occurrences o
       join reminders r on r.id = o.reminder_id
       where r.user_id = $1 and o.status in ('pending','fired')
       order by o.scheduled_for asc`,
      [userId]
    );

    const withReminders = await Promise.all(
      rows.map(async (row) => {
        const reminder = await this.getReminder(row.reminder_id);
        if (!reminder) return null;
        return { ...rowToOccurrence(row), reminder };
      })
    );
    return withReminders.filter(Boolean) as (ReminderOccurrence & { reminder: Reminder })[];
  }

  async addOccurrence(reminderId: string, scheduledFor: string) {
    const id = newId();
    await exec(
      getPool(),
      `insert into reminder_occurrences (id, reminder_id, scheduled_for, status) values ($1, $2, $3, 'pending')`,
      [id, reminderId, scheduledFor]
    );
    const row = await one<any>(getPool(), `select * from reminder_occurrences where id = $1`, [id]);
    return rowToOccurrence(row!);
  }

  async markOccurrenceNotified(occurrenceId: string, escalated: boolean) {
    await exec(
      getPool(),
      `update reminder_occurrences
       set status = 'fired', fired_at = $1, repeat_count = repeat_count + 1, escalated = $2
       where id = $3`,
      [new Date().toISOString(), escalated, occurrenceId]
    );
  }

  async updateOccurrenceFollowUp(
    occurrenceId: string,
    fields: Partial<{
      follow_up_state: string;
      notification_attempt_count: number;
      escalation_level: number;
      last_notified_at: string | null;
      next_follow_up_at: string | null;
    }>
  ) {
    const columns = Object.keys(fields);
    if (columns.length === 0) return;
    const params: unknown[] = [];
    const sets = columns.map((c) => {
      params.push((fields as Record<string, unknown>)[c]);
      return `${c} = $${params.length}`;
    });
    params.push(occurrenceId);
    await exec(getPool(), `update reminder_occurrences set ${sets.join(", ")} where id = $${params.length}`, params);
  }

  async stopOccurrenceFollowUp(reminderId: string, state: "completed" | "cancelled") {
    await exec(
      getPool(),
      `update reminder_occurrences
       set follow_up_state = $1, next_follow_up_at = null
       where reminder_id = $2 and follow_up_state not in ('completed','cancelled')`,
      [state, reminderId]
    );
  }

  async listHistory(reminderId: string) {
    const rows = await many<any>(
      getPool(),
      `select * from reminder_history where reminder_id = $1 order by created_at desc`,
      [reminderId]
    );
    return rows.map((r) => ({ ...r, created_at: toISO(r.created_at) })) as ReminderHistoryEntry[];
  }

  async addHistory(reminderId: string, action: ReminderHistoryEntry["action"], detail?: string, occurrenceId?: string) {
    await exec(
      getPool(),
      `insert into reminder_history (id, reminder_id, action, detail, created_at, occurrence_id) values ($1, $2, $3, $4, $5, $6)`,
      [newId(), reminderId, action, detail ?? null, new Date().toISOString(), occurrenceId ?? null]
    );
  }

  private rowToPushSubscription(row: any): PushSubscriptionRecord {
    return {
      ...row,
      active: !!row.active,
      created_at: toISO(row.created_at),
      updated_at: toISO(row.updated_at),
      last_failure_at: toISO(row.last_failure_at),
    };
  }

  async upsertPushSubscription(userId: string, sub: { endpoint: string; p256dh: string; auth: string }) {
    const now = new Date().toISOString();
    // ON CONFLICT (endpoint) DO UPDATE ... RETURNING * — atomic, single
    // round-trip upsert. This is the Postgres-correct replacement for
    // local.ts's "select existing, then update-or-insert" two-step, and
    // additionally closes a race the SQLite version has (two concurrent
    // upserts for a brand-new endpoint could both see "no existing row").
    const row = await one<any>(
      getPool(),
      `insert into push_subscriptions (id, user_id, endpoint, p256dh, auth, active, failure_count, created_at, updated_at)
       values ($1, $2, $3, $4, $5, true, 0, $6, $6)
       on conflict (endpoint) do update set
         user_id = excluded.user_id,
         p256dh = excluded.p256dh,
         auth = excluded.auth,
         active = true,
         failure_count = 0,
         last_failure_at = null,
         updated_at = excluded.updated_at
       returning *`,
      [newId(), userId, sub.endpoint, sub.p256dh, sub.auth, now]
    );
    return this.rowToPushSubscription(row!);
  }

  async listActivePushSubscriptions(userId: string) {
    const rows = await many<any>(
      getPool(),
      `select * from push_subscriptions where user_id = $1 and active = true`,
      [userId]
    );
    return rows.map((r) => this.rowToPushSubscription(r));
  }

  async deactivatePushSubscription(endpoint: string) {
    await exec(getPool(), `update push_subscriptions set active = false, updated_at = $1 where endpoint = $2`, [
      new Date().toISOString(),
      endpoint,
    ]);
  }

  async recordPushFailure(endpoint: string) {
    await exec(
      getPool(),
      `update push_subscriptions
       set failure_count = failure_count + 1, last_failure_at = $1, updated_at = $1
       where endpoint = $2`,
      [new Date().toISOString(), endpoint]
    );
  }

  // --- V5: Payment Intelligence --------------------------------------

  private rowToPaymentAccount(row: any): PaymentAccount {
    return {
      id: row.id,
      user_id: row.user_id,
      name: row.name,
      payment_type: row.payment_type,
      issuer: row.issuer,
      masked_identifier: row.masked_identifier,
      active: !!row.active,
      statement_date_rule: row.statement_date_rule,
      due_date_rule: row.due_date_rule,
      fixed_due_day: row.fixed_due_day,
      due_days_after_statement: row.due_days_after_statement,
      default_amount: Number(row.default_amount),
      minimum_amount: row.minimum_amount == null ? null : Number(row.minimum_amount),
      autopay_enabled: !!row.autopay_enabled,
      reminder_enabled: !!row.reminder_enabled,
      escalation_enabled: !!row.escalation_enabled,
      created_at: toISO(row.created_at) as string,
      updated_at: toISO(row.updated_at) as string,
    };
  }

  private rowToPaymentCycle(row: any): PaymentCycle {
    return {
      id: row.id,
      payment_account_id: row.payment_account_id,
      cycle_period: row.cycle_period,
      statement_date: toDateStr(row.statement_date) as string,
      due_date: toDateStr(row.due_date) as string,
      amount: Number(row.amount),
      minimum_amount: row.minimum_amount == null ? null : Number(row.minimum_amount),
      status: row.status,
      paid_at: toISO(row.paid_at),
      reminder_id: row.reminder_id,
      created_at: toISO(row.created_at) as string,
      updated_at: toISO(row.updated_at) as string,
    };
  }

  async listPaymentAccounts(userId: string) {
    const rows = await many<any>(
      getPool(),
      `select * from payment_accounts where user_id = $1 order by created_at desc`,
      [userId]
    );
    return rows.map((r) => this.rowToPaymentAccount(r));
  }

  async getPaymentAccount(id: string) {
    const row = await one<any>(getPool(), `select * from payment_accounts where id = $1`, [id]);
    return row ? this.rowToPaymentAccount(row) : null;
  }

  async createPaymentAccount(userId: string, input: PaymentAccountInput) {
    const id = newId();
    const now = new Date().toISOString();
    await exec(
      getPool(),
      `insert into payment_accounts (
        id, user_id, name, payment_type, issuer, masked_identifier, active,
        statement_date_rule, due_date_rule, fixed_due_day, due_days_after_statement,
        default_amount, minimum_amount, autopay_enabled, reminder_enabled, escalation_enabled,
        created_at, updated_at
      ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$17)`,
      [
        id,
        userId,
        input.name,
        input.payment_type,
        input.issuer ?? null,
        input.masked_identifier ?? null,
        !!input.active,
        input.statement_date_rule,
        input.due_date_rule,
        input.fixed_due_day ?? null,
        input.due_days_after_statement ?? null,
        input.default_amount,
        input.minimum_amount ?? null,
        !!input.autopay_enabled,
        !!input.reminder_enabled,
        !!input.escalation_enabled,
        now,
      ]
    );
    return (await this.getPaymentAccount(id))!;
  }

  async updatePaymentAccount(id: string, update: PaymentAccountUpdate) {
    const existing = await this.getPaymentAccount(id);
    if (!existing) return null;
    const now = new Date().toISOString();

    const columnMap: Record<string, string> = {
      name: "name",
      payment_type: "payment_type",
      issuer: "issuer",
      masked_identifier: "masked_identifier",
      active: "active",
      statement_date_rule: "statement_date_rule",
      due_date_rule: "due_date_rule",
      fixed_due_day: "fixed_due_day",
      due_days_after_statement: "due_days_after_statement",
      default_amount: "default_amount",
      minimum_amount: "minimum_amount",
      autopay_enabled: "autopay_enabled",
      reminder_enabled: "reminder_enabled",
      escalation_enabled: "escalation_enabled",
    };

    const params: unknown[] = [];
    const sets: string[] = [];
    for (const [key, column] of Object.entries(columnMap)) {
      if (!(key in update)) continue;
      params.push((update as Record<string, unknown>)[key]);
      sets.push(`${column} = $${params.length}`);
    }
    if (sets.length) {
      params.push(now);
      const updatedIdx = params.length;
      params.push(id);
      await exec(
        getPool(),
        `update payment_accounts set ${sets.join(", ")}, updated_at = $${updatedIdx} where id = $${params.length}`,
        params
      );
    }
    return this.getPaymentAccount(id);
  }

  async setPaymentAccountActive(id: string, active: boolean) {
    await exec(getPool(), `update payment_accounts set active = $1, updated_at = $2 where id = $3`, [
      active,
      new Date().toISOString(),
      id,
    ]);
    return this.getPaymentAccount(id);
  }

  async listPaymentCycles(accountId: string) {
    const rows = await many<any>(
      getPool(),
      `select * from payment_cycles where payment_account_id = $1 order by due_date desc`,
      [accountId]
    );
    return rows.map((r) => this.rowToPaymentCycle(r));
  }

  async getPaymentCycle(id: string) {
    const row = await one<any>(getPool(), `select * from payment_cycles where id = $1`, [id]);
    return row ? this.rowToPaymentCycle(row) : null;
  }

  async getPaymentCycleByPeriod(accountId: string, cyclePeriod: string) {
    const row = await one<any>(
      getPool(),
      `select * from payment_cycles where payment_account_id = $1 and cycle_period = $2`,
      [accountId, cyclePeriod]
    );
    return row ? this.rowToPaymentCycle(row) : null;
  }

  async createPaymentCycle(
    accountId: string,
    fields: { cyclePeriod: string; statementDate: string; dueDate: string; amount: number; minimumAmount: number | null }
  ) {
    // Idempotency: unique(payment_account_id, cycle_period) + ON CONFLICT DO
    // NOTHING — calling this twice for the same period never creates a
    // duplicate row and always resolves to the single real cycle, exactly
    // like local.ts's "insert or ignore" + re-read, but atomic in one
    // round trip via RETURNING (falls through to a plain re-read only when
    // the conflict path is taken, since ON CONFLICT DO NOTHING returns no
    // row for the conflicting insert).
    const id = newId();
    const now = new Date().toISOString();
    await exec(
      getPool(),
      `insert into payment_cycles
        (id, payment_account_id, cycle_period, statement_date, due_date, amount, minimum_amount, status, created_at, updated_at)
       values ($1,$2,$3,$4,$5,$6,$7,'upcoming',$8,$8)
       on conflict (payment_account_id, cycle_period) do nothing`,
      [id, accountId, fields.cyclePeriod, fields.statementDate, fields.dueDate, fields.amount, fields.minimumAmount, now]
    );
    return (await this.getPaymentCycleByPeriod(accountId, fields.cyclePeriod))!;
  }

  async linkPaymentCycleReminder(cycleId: string, reminderId: string) {
    await exec(getPool(), `update payment_cycles set reminder_id = $1, updated_at = $2 where id = $3`, [
      reminderId,
      new Date().toISOString(),
      cycleId,
    ]);
  }

  async updatePaymentCycleStatus(cycleId: string, status: PaymentCycle["status"]) {
    await exec(
      getPool(),
      `update payment_cycles set status = $1, updated_at = $2 where id = $3 and status != 'paid'`,
      [status, new Date().toISOString(), cycleId]
    );
  }

  async markPaymentCyclePaid(cycleId: string) {
    // Idempotency + atomicity: the status flip is guarded by `status !=
    // 'paid'` and done with RETURNING inside one statement, so two
    // near-simultaneous calls can only have ONE of them actually observe a
    // row flip from non-paid to paid (Postgres row-level locking during the
    // UPDATE serializes the two statements) — the loser's UPDATE affects 0
    // rows and this method treats that as "already paid", matching
    // local.ts's documented idempotency guarantee but now safe under real
    // concurrency, not just within a single synchronous process.
    return withTx(async (client) => {
      const existing = await one<any>(client, `select * from payment_cycles where id = $1`, [cycleId]);
      if (!existing) return null;
      if (existing.status === "paid") return this.rowToPaymentCycle(existing);

      const now = new Date().toISOString();
      const updated = await one<any>(
        client,
        `update payment_cycles set status = 'paid', paid_at = $1, updated_at = $1
         where id = $2 and status != 'paid'
         returning *`,
        [now, cycleId]
      );
      if (!updated) {
        // Lost the race to a concurrent caller — re-read the now-paid row.
        const row = await one<any>(client, `select * from payment_cycles where id = $1`, [cycleId]);
        return row ? this.rowToPaymentCycle(row) : null;
      }

      // Reuse the EXISTING completeReminder path so the linked reminder's
      // occurrence follow_up_state becomes "completed" and all future
      // notifications stop — no new completion mechanism. Done inside the
      // same transaction as the status flip so both changes are atomic.
      if (updated.reminder_id) {
        await exec(client, `update reminders set status = 'completed', completed_at = $1, updated_at = $1 where id = $2`, [
          now,
          updated.reminder_id,
        ]);
        await exec(
          client,
          `update reminder_occurrences set status = 'acknowledged' where reminder_id = $1 and status in ('pending','fired')`,
          [updated.reminder_id]
        );
        await exec(
          client,
          `update reminder_occurrences
           set follow_up_state = 'completed', next_follow_up_at = null
           where reminder_id = $1 and follow_up_state not in ('completed','cancelled')`,
          [updated.reminder_id]
        );
        await exec(
          client,
          `insert into reminder_history (id, reminder_id, action, detail, created_at) values ($1, $2, 'completed', null, $3)`,
          [newId(), updated.reminder_id, now]
        );
      }
      return this.rowToPaymentCycle(updated);
    });
  }

  // --- V8: Proactive Intelligence --------------------------------------

  private rowToProactiveNotification(row: any): ProactiveNotificationRecord {
    return {
      id: row.id,
      user_id: row.user_id,
      rule_id: row.rule_id,
      subject_type: row.subject_type,
      subject_id: row.subject_id,
      priority: row.priority,
      channel: row.channel,
      message: row.message,
      outcome: row.outcome,
      fired_at: toISO(row.fired_at) as string,
    };
  }

  async getLastProactiveNotification(userId: string, ruleId: string, subjectType: string, subjectId: string) {
    const row = await one<any>(
      getPool(),
      `select * from proactive_notifications
       where user_id = $1 and rule_id = $2 and subject_type = $3 and subject_id = $4
       order by fired_at desc limit 1`,
      [userId, ruleId, subjectType, subjectId]
    );
    return row ? this.rowToProactiveNotification(row) : null;
  }

  async logProactiveNotification(args: {
    userId: string;
    ruleId: string;
    subjectType: "reminder" | "payment_cycle" | "cluster";
    subjectId: string;
    priority: "low" | "medium" | "high" | "urgent";
    channel: NotificationChannel | null;
    message: string;
    outcome: ProactiveNotificationOutcome;
  }) {
    const id = newId();
    const now = new Date().toISOString();
    await exec(
      getPool(),
      `insert into proactive_notifications (id, user_id, rule_id, subject_type, subject_id, priority, channel, message, outcome, fired_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [id, args.userId, args.ruleId, args.subjectType, args.subjectId, args.priority, args.channel, args.message, args.outcome, now]
    );
    const row = await one<any>(getPool(), `select * from proactive_notifications where id = $1`, [id]);
    return this.rowToProactiveNotification(row!);
  }

  async listProactiveNotifications(userId: string, limit = 50) {
    const rows = await many<any>(
      getPool(),
      `select * from proactive_notifications where user_id = $1 order by fired_at desc limit $2`,
      [userId, limit]
    );
    return rows.map((r) => this.rowToProactiveNotification(r));
  }

  // --- V11: Integrations + Automation ------------------------------------

  async wasCreatedByAutomation(reminderId: string) {
    const row = await one<{ created_by_automation: boolean }>(
      getPool(),
      `select created_by_automation from reminders where id = $1`,
      [reminderId]
    );
    return !!row?.created_by_automation;
  }

  private rowToIntegrationAccount(row: any): IntegrationAccountRecord {
    return {
      id: row.id,
      user_id: row.user_id,
      provider: row.provider,
      status: row.status,
      access_token: row.access_token,
      refresh_token: row.refresh_token,
      expires_at: toISO(row.expires_at),
      connected_at: toISO(row.connected_at),
      last_sync_at: toISO(row.last_sync_at),
      last_error: row.last_error,
      created_at: toISO(row.created_at) as string,
      updated_at: toISO(row.updated_at) as string,
    };
  }

  async getIntegrationAccount(userId: string, provider: IntegrationProvider) {
    const row = await one<any>(
      getPool(),
      `select * from integration_accounts where user_id = $1 and provider = $2`,
      [userId, provider]
    );
    return row ? this.rowToIntegrationAccount(row) : null;
  }

  async upsertIntegrationAccount(
    userId: string,
    provider: IntegrationProvider,
    fields: Partial<{
      status: IntegrationStatus;
      access_token: string | null;
      refresh_token: string | null;
      expires_at: string | null;
      connected_at: string | null;
      last_sync_at: string | null;
      last_error: string | null;
    }>
  ) {
    const now = new Date().toISOString();
    const existing = await this.getIntegrationAccount(userId, provider);
    if (!existing) {
      const id = newId();
      await exec(
        getPool(),
        `insert into integration_accounts
         (id, user_id, provider, status, access_token, refresh_token, expires_at, connected_at, last_sync_at, last_error, created_at, updated_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11)`,
        [
          id,
          userId,
          provider,
          fields.status ?? "not_connected",
          fields.access_token ?? null,
          fields.refresh_token ?? null,
          fields.expires_at ?? null,
          fields.connected_at ?? null,
          fields.last_sync_at ?? null,
          fields.last_error ?? null,
          now,
        ]
      );
      return (await this.getIntegrationAccount(userId, provider))!;
    }
    const merged = { ...existing, ...fields };
    await exec(
      getPool(),
      `update integration_accounts set status = $1, access_token = $2, refresh_token = $3,
       expires_at = $4, connected_at = $5, last_sync_at = $6, last_error = $7, updated_at = $8 where id = $9`,
      [
        merged.status,
        merged.access_token,
        merged.refresh_token,
        merged.expires_at,
        merged.connected_at,
        merged.last_sync_at,
        merged.last_error,
        now,
        existing.id,
      ]
    );
    return (await this.getIntegrationAccount(userId, provider))!;
  }

  private rowToAutomation(row: any): AutomationRecord {
    return {
      id: row.id,
      user_id: row.user_id,
      name: row.name,
      trigger_type: row.trigger_type,
      trigger_config: row.trigger_config,
      condition_config: row.condition_config,
      action_type: row.action_type,
      action_config: row.action_config,
      enabled: !!row.enabled,
      created_at: toISO(row.created_at) as string,
      updated_at: toISO(row.updated_at) as string,
      last_run_at: toISO(row.last_run_at),
    };
  }

  async listAutomations(userId: string) {
    const rows = await many<any>(
      getPool(),
      `select * from automations where user_id = $1 order by created_at desc`,
      [userId]
    );
    return rows.map((r) => this.rowToAutomation(r));
  }

  async getAutomation(id: string) {
    const row = await one<any>(getPool(), `select * from automations where id = $1`, [id]);
    return row ? this.rowToAutomation(row) : null;
  }

  async createAutomation(userId: string, input: AutomationInput) {
    const id = newId();
    const now = new Date().toISOString();
    await exec(
      getPool(),
      `insert into automations
       (id, user_id, name, trigger_type, trigger_config, condition_config, action_type, action_config, enabled, created_at, updated_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10)`,
      [
        id,
        userId,
        input.name,
        input.trigger_type,
        JSON.stringify(input.trigger_config ?? {}),
        input.condition_config ? JSON.stringify(input.condition_config) : null,
        input.action_type,
        JSON.stringify(input.action_config),
        input.enabled !== false,
        now,
      ]
    );
    return (await this.getAutomation(id))!;
  }

  async updateAutomation(
    id: string,
    changes: Partial<Pick<AutomationRecord, "name" | "enabled" | "trigger_config" | "condition_config" | "action_config">>
  ) {
    const existing = await this.getAutomation(id);
    if (!existing) return null;
    const now = new Date().toISOString();
    const merged = {
      name: changes.name ?? existing.name,
      enabled: changes.enabled ?? existing.enabled,
      trigger_config: changes.trigger_config ?? existing.trigger_config,
      condition_config: changes.condition_config !== undefined ? changes.condition_config : existing.condition_config,
      action_config: changes.action_config ?? existing.action_config,
    };
    await exec(
      getPool(),
      `update automations set name = $1, enabled = $2, trigger_config = $3,
       condition_config = $4, action_config = $5, updated_at = $6 where id = $7`,
      [merged.name, merged.enabled, merged.trigger_config, merged.condition_config, merged.action_config, now, id]
    );
    return this.getAutomation(id);
  }

  async deleteAutomation(id: string) {
    await exec(getPool(), `delete from automations where id = $1`, [id]);
  }

  async touchAutomationLastRun(id: string, at: string) {
    await exec(getPool(), `update automations set last_run_at = $1 where id = $2`, [at, id]);
  }

  async logAutomationRun(args: {
    automationId: string;
    triggerContext?: string | null;
    outcome: AutomationRunOutcome;
    detail?: string | null;
  }) {
    const id = newId();
    const now = new Date().toISOString();
    await exec(
      getPool(),
      `insert into automation_runs (id, automation_id, triggered_at, trigger_context, outcome, detail, created_at)
       values ($1,$2,$3,$4,$5,$6,$3)`,
      [id, args.automationId, now, args.triggerContext ?? null, args.outcome, args.detail ?? null]
    );
    const row = await one<any>(getPool(), `select * from automation_runs where id = $1`, [id]);
    return { ...row, triggered_at: toISO(row.triggered_at), created_at: toISO(row.created_at) } as AutomationRunRecord;
  }

  async listAutomationRuns(automationId: string, limit = 50) {
    const rows = await many<any>(
      getPool(),
      `select * from automation_runs where automation_id = $1 order by triggered_at desc limit $2`,
      [automationId, limit]
    );
    return rows.map((r) => ({ ...r, triggered_at: toISO(r.triggered_at), created_at: toISO(r.created_at) })) as AutomationRunRecord[];
  }

  // --- V12: Analytics ---------------------------------------------------

  async getAnalyticsSnapshot(userId: string, sinceISO: string): Promise<AnalyticsSnapshot> {
    const reminderRows = await many<any>(
      getPool(),
      `select * from reminders where user_id = $1 and (created_at >= $2 or updated_at >= $2) order by created_at asc`,
      [userId, sinceISO]
    );
    const reminders = await Promise.all(reminderRows.map((r) => rowToReminder(getPool(), r)));
    const reminderIds = reminders.map((r) => r.id);

    const occurrences: ReminderOccurrence[] =
      reminderIds.length === 0
        ? []
        : (
            await many<any>(getPool(), `select * from reminder_occurrences where reminder_id = any($1::uuid[])`, [reminderIds])
          ).map((r) => rowToOccurrence(r));

    const notifications: NotificationLogEntry[] =
      reminderIds.length === 0
        ? []
        : (
            await many<any>(
              getPool(),
              `select * from notifications where reminder_id = any($1::uuid[]) and sent_at >= $2`,
              [reminderIds, sinceISO]
            )
          ).map((r) => ({ ...r, sent_at: toISO(r.sent_at) }));

    const history: ReminderHistoryEntry[] =
      reminderIds.length === 0
        ? []
        : (
            await many<any>(
              getPool(),
              `select * from reminder_history where reminder_id = any($1::uuid[]) and created_at >= $2`,
              [reminderIds, sinceISO]
            )
          ).map((r) => ({ ...r, created_at: toISO(r.created_at) }));

    const paymentCycles = (
      await many<any>(
        getPool(),
        `select pc.* from payment_cycles pc
         join payment_accounts pa on pa.id = pc.payment_account_id
         where pa.user_id = $1 and pc.updated_at >= $2
         order by pc.due_date asc`,
        [userId, sinceISO]
      )
    ).map((r) => this.rowToPaymentCycle(r));

    const automationRuns = (
      await many<any>(
        getPool(),
        `select ar.*, a.trigger_type as trigger_type, a.name as automation_name
         from automation_runs ar
         join automations a on a.id = ar.automation_id
         where a.user_id = $1 and ar.triggered_at >= $2
         order by ar.triggered_at asc`,
        [userId, sinceISO]
      )
    ).map((r) => ({
      ...r,
      triggered_at: toISO(r.triggered_at),
      created_at: toISO(r.created_at),
    })) as (AutomationRunRecord & { trigger_type: string; automation_name: string })[];

    const proactiveNotifications = (
      await many<any>(
        getPool(),
        `select * from proactive_notifications where user_id = $1 and fired_at >= $2 order by fired_at asc`,
        [userId, sinceISO]
      )
    ).map((r) => this.rowToProactiveNotification(r));

    return { reminders, occurrences, notifications, history, paymentCycles, automationRuns, proactiveNotifications };
  }

  async listRecommendationStates(userId: string) {
    const rows = await many<any>(getPool(), `select * from analytics_recommendations where user_id = $1`, [userId]);
    return rows.map((r) => ({
      ...r,
      created_at: toISO(r.created_at),
      updated_at: toISO(r.updated_at),
    })) as AnalyticsRecommendationRecord[];
  }

  async ensureRecommendation(
    userId: string,
    id: string,
    fields: { type: string; subjectType: string; subjectId: string; payload: string }
  ) {
    const now = new Date().toISOString();
    await exec(
      getPool(),
      `insert into analytics_recommendations (id, user_id, type, subject_type, subject_id, payload, status, created_at, updated_at)
       values ($1,$2,$3,$4,$5,$6,'pending',$7,$7)
       on conflict (id) do nothing`,
      [id, userId, fields.type, fields.subjectType, fields.subjectId, fields.payload, now]
    );
  }

  async setRecommendationStatus(id: string, status: AnalyticsRecommendationStatus) {
    const row = await one<any>(
      getPool(),
      `update analytics_recommendations set status = $1, updated_at = $2 where id = $3 returning *`,
      [status, new Date().toISOString(), id]
    );
    return row
      ? ({ ...row, created_at: toISO(row.created_at), updated_at: toISO(row.updated_at) } as AnalyticsRecommendationRecord)
      : null;
  }
}

function rowToOccurrence(row: any): ReminderOccurrence {
  return {
    ...row,
    scheduled_for: toISO(row.scheduled_for) as string,
    fired_at: toISO(row.fired_at),
    escalated: !!row.escalated,
    last_notified_at: toISO(row.last_notified_at),
    next_follow_up_at: toISO(row.next_follow_up_at),
  };
}

export const supabaseDataLayer: DataLayer = new SupabaseDataLayer();

/**
 * Exposed for tests / diagnostics that need to close the pool explicitly
 * (e.g. so a Vitest run exits cleanly instead of waiting on open sockets).
 */
export async function closeSupabasePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
