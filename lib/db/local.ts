/* eslint-disable @typescript-eslint/no-explicit-any -- raw better-sqlite3 rows are untyped by design */
import path from "path";
import fs from "fs";
import Database from "better-sqlite3";
import { ensureSchema } from "./schema-sqlite";
import { newId } from "@/lib/utils/id";
import type { DataLayer, ReminderFilter } from "./types";
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
} from "@/types/reminder";
import { seedIfEmpty } from "./seed-data";

const DEFAULT_DB_PATH = path.join(process.cwd(), "database", "nova.sqlite");

function getDbPath(): string {
  return process.env.NOVA_SQLITE_PATH
    ? path.resolve(process.cwd(), process.env.NOVA_SQLITE_PATH)
    : DEFAULT_DB_PATH;
}

let dbInstance: Database.Database | null = null;

function getDb(): Database.Database {
  if (dbInstance) return dbInstance;
  const dbPath = getDbPath();
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  ensureSchema(db);
  seedIfEmpty(db);
  dbInstance = db;
  return db;
}

function rowToReminder(db: Database.Database, row: any): Reminder {
  const typeRows = db
    .prepare(
      `select rt.key from reminder_type_assignments a
       join reminder_types rt on rt.id = a.reminder_type_id
       where a.reminder_id = ?`
    )
    .all(row.id) as { key: ReminderTypeKey }[];
  const types = typeRows.map((t) => t.key);

  let payment: PaymentDetails | null = null;
  if (types.includes("payment")) {
    const p = db
      .prepare(`select * from payment_details where reminder_id = ?`)
      .get(row.id) as any;
    if (p) {
      payment = {
        id: p.reminder_id,
        reminder_id: p.reminder_id,
        amount: p.amount,
        currency: p.currency,
        payee: p.payee,
        account_last4: p.account_last4,
        category: p.category,
        billing_date: p.billing_date,
        due_date: p.due_date,
        autopay: !!p.autopay,
        paid_status: p.paid_status,
      };
    }
  }

  let call: CallDetails | null = null;
  if (types.includes("call")) {
    const c = db.prepare(`select * from call_details where reminder_id = ?`).get(row.id) as any;
    if (c) call = { contact_name: c.contact_name, phone_number: c.phone_number ?? undefined };
  }

  let meeting: MeetingDetails | null = null;
  if (types.includes("meeting")) {
    const m = db.prepare(`select * from meeting_details where reminder_id = ?`).get(row.id) as any;
    if (m) {
      meeting = {
        location: m.location ?? undefined,
        meeting_link: m.meeting_link ?? undefined,
        attendees: m.attendees ? JSON.parse(m.attendees) : [],
      };
    }
  }

  let followUp: FollowUpDetails | null = null;
  if (types.includes("follow_up")) {
    const f = db.prepare(`select * from follow_up_details where reminder_id = ?`).get(row.id) as any;
    if (f) followUp = { related_to: f.related_to ?? undefined, last_contacted_at: f.last_contacted_at };
  }

  let recurrence: RecurrenceRule | null = null;
  if (types.includes("recurring")) {
    const r = db.prepare(`select * from recurrence_rules where reminder_id = ?`).get(row.id) as any;
    if (r) {
      recurrence = {
        id: r.id,
        reminder_id: r.reminder_id,
        frequency: r.frequency,
        interval: r.interval,
        by_day_of_month: r.by_day_of_month,
        by_month: r.by_month,
        by_weekday: r.by_weekday ? JSON.parse(r.by_weekday) : null,
        ends_at: r.ends_at,
        occurrences_limit: r.occurrences_limit,
      };
    }
  }

  const nextOcc = db
    .prepare(
      `select scheduled_for from reminder_occurrences
       where reminder_id = ? and status in ('pending','fired')
       order by scheduled_for asc limit 1`
    )
    .get(row.id) as { scheduled_for: string } | undefined;

  const channelRows = db
    .prepare(`select channel from reminder_notification_channels where reminder_id = ?`)
    .all(row.id) as { channel: NotificationChannel }[];

  return {
    id: row.id,
    user_id: row.user_id,
    title: row.title,
    description: row.description,
    date: row.date,
    time: row.time,
    priority: row.priority,
    notes: row.notes,
    status: row.status,
    created_at: row.created_at,
    updated_at: row.updated_at,
    completed_at: row.completed_at,
    types,
    payment,
    call,
    meeting,
    follow_up: followUp,
    recurrence,
    next_occurrence: nextOcc?.scheduled_for ?? null,
    channels: channelRows.map((c) => c.channel),
    intensity: row.intensity ?? "normal",
  };
}

class LocalDataLayer implements DataLayer {
  getCurrentUserId(): string {
    const db = getDb();
    const row = db.prepare(`select id from users limit 1`).get() as { id: string };
    return row.id;
  }

  getPreferences(userId: string): UserPreferences {
    const db = getDb();
    const row = db
      .prepare(`select * from user_preferences where user_id = ?`)
      .get(userId) as any;
    const user = db.prepare(`select display_name from users where id = ?`).get(userId) as any;
    const channelRows = db
      .prepare(`select channel from user_preferred_channels where user_id = ?`)
      .all(userId) as { channel: NotificationChannel }[];
    return {
      user_id: userId,
      display_name: user?.display_name ?? "You",
      reminder_lead_days: row ? JSON.parse(row.reminder_lead_days) : [7, 3, 1],
      repeat_interval_minutes: row?.repeat_interval_minutes ?? 120,
      escalation_enabled: row ? !!row.escalation_enabled : true,
      theme: row?.theme ?? "dark",
      preferred_name: row?.preferred_name ?? null,
      nova_should_call_user: row?.nova_should_call_user ?? null,
      default_reminder_time: row?.default_reminder_time ?? "09:00",
      default_snooze_minutes: row?.default_snooze_minutes ?? 15,
      default_notification_behavior: row?.default_notification_behavior ?? "notify_once",
      timezone: row?.timezone ?? "UTC",
      quiet_hours_start: row?.quiet_hours_start ?? null,
      quiet_hours_end: row?.quiet_hours_end ?? null,
      default_intensity: row?.default_intensity ?? "normal",
      repeat_ignored_reminders: row ? !!row.repeat_ignored_reminders : true,
      escalate_urgent_reminders: row ? !!row.escalate_urgent_reminders : true,
      preferred_channels: channelRows.map((c) => c.channel),
      max_follow_up_attempts: row?.max_follow_up_attempts ?? 8,
      escalation_threshold_repeats: row?.escalation_threshold_repeats ?? 3,
      phone_number: row?.phone_number ?? null,
      proactive_intelligence_enabled: row ? !!row.proactive_intelligence_enabled : true,
    };
  }

  updatePreferences(userId: string, update: UserPreferencesUpdate): UserPreferences {
    const db = getDb();
    const now = new Date().toISOString();

    const existing = db.prepare(`select user_id from user_preferences where user_id = ?`).get(userId);
    if (!existing) {
      db.prepare(
        `insert into user_preferences (user_id, updated_at) values (?, ?)`
      ).run(userId, now);
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
    const params: Record<string, unknown> = { user_id: userId, updated_at: now };
    for (const [key, column] of Object.entries(columnMap)) {
      if (!(key in update)) continue;
      const value = (update as Record<string, unknown>)[key];
      let stored: unknown = value;
      if (key === "reminder_lead_days") stored = JSON.stringify(value);
      if (typeof value === "boolean") stored = value ? 1 : 0;
      sets.push(`${column} = @${column}`);
      params[column] = stored;
    }

    if (sets.length) {
      db.prepare(
        `update user_preferences set ${sets.join(", ")}, updated_at = @updated_at where user_id = @user_id`
      ).run(params);
    } else {
      db.prepare(`update user_preferences set updated_at = ? where user_id = ?`).run(now, userId);
    }

    if (update.preferred_channels) {
      const tx = db.transaction(() => {
        db.prepare(`delete from user_preferred_channels where user_id = ?`).run(userId);
        for (const channel of update.preferred_channels!) {
          db.prepare(
            `insert or ignore into user_preferred_channels (user_id, channel) values (?, ?)`
          ).run(userId, channel);
        }
      });
      tx();
    }

    return this.getPreferences(userId);
  }

  private rowToPersonalContext(row: Record<string, unknown>): PersonalContextEntry {
    return {
      ...(row as Omit<PersonalContextEntry, "active">),
      active: !!row.active,
    } as PersonalContextEntry;
  }

  listPersonalContext(userId: string, options?: { includeInactive?: boolean }): PersonalContextEntry[] {
    const db = getDb();
    const rows = options?.includeInactive
      ? db
          .prepare(`select * from personal_context_entries where user_id = ? order by created_at desc`)
          .all(userId)
      : db
          .prepare(
            `select * from personal_context_entries where user_id = ? and active = 1 order by created_at desc`
          )
          .all(userId);
    return (rows as Record<string, unknown>[]).map((r) => this.rowToPersonalContext(r));
  }

  addPersonalContext(
    userId: string,
    entry: { category?: string; label: string; value: string; source?: MemorySource }
  ): PersonalContextEntry {
    const db = getDb();
    const id = newId();
    const now = new Date().toISOString();
    db.prepare(
      `insert into personal_context_entries (id, user_id, category, label, value, source, active, created_at, updated_at)
       values (?, ?, ?, ?, ?, ?, 1, ?, ?)`
    ).run(id, userId, entry.category ?? "general", entry.label, entry.value, entry.source ?? "user_entered", now, now);
    return this.rowToPersonalContext(
      db.prepare(`select * from personal_context_entries where id = ?`).get(id) as Record<string, unknown>
    );
  }

  updatePersonalContext(
    id: string,
    changes: { category?: string; label?: string; value?: string; active?: boolean }
  ): PersonalContextEntry | null {
    const db = getDb();
    const now = new Date().toISOString();
    const existing = db.prepare(`select * from personal_context_entries where id = ?`).get(id) as
      | Record<string, unknown>
      | undefined;
    if (!existing) return null;
    db.prepare(
      `update personal_context_entries set category = ?, label = ?, value = ?, active = ?, updated_at = ? where id = ?`
    ).run(
      changes.category ?? (existing.category as string),
      changes.label ?? (existing.label as string),
      changes.value ?? (existing.value as string),
      changes.active === undefined ? (existing.active as number) : changes.active ? 1 : 0,
      now,
      id
    );
    return this.rowToPersonalContext(
      db.prepare(`select * from personal_context_entries where id = ?`).get(id) as Record<string, unknown>
    );
  }

  deletePersonalContext(id: string): void {
    const db = getDb();
    db.prepare(`delete from personal_context_entries where id = ?`).run(id);
  }

  logNotification(args: {
    reminderId: string;
    occurrenceId: string;
    channel: NotificationChannel | "in_app";
    message: string;
    outcome: NotificationOutcome;
    attemptNumber?: number;
    escalationLevel?: number;
    providerRef?: string | null;
  }): void {
    const db = getDb();
    const now = new Date().toISOString();
    db.prepare(
      `insert into notifications (id, reminder_id, occurrence_id, sent_at, channel, message, outcome, attempt_number, escalation_level, provider_ref)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      newId(),
      args.reminderId,
      args.occurrenceId,
      now,
      args.channel,
      args.message,
      args.outcome,
      args.attemptNumber ?? 1,
      args.escalationLevel ?? 0,
      args.providerRef ?? null
    );
    const action = (args.escalationLevel ?? 0) > 0 ? "escalated" : "notified";
    db.prepare(
      `insert into reminder_history (id, reminder_id, action, detail, created_at, occurrence_id) values (?, ?, ?, ?, ?, ?)`
    ).run(
      newId(),
      args.reminderId,
      action,
      `${args.channel}: ${args.outcome} (attempt ${args.attemptNumber ?? 1})`,
      now,
      args.occurrenceId
    );
  }

  listNotifications(reminderId: string) {
    const db = getDb();
    return db
      .prepare(`select * from notifications where reminder_id = ? order by sent_at desc`)
      .all(reminderId) as import("@/types/reminder").NotificationLogEntry[];
  }

  listReminders(userId: string, filter?: ReminderFilter): Reminder[] {
    const db = getDb();
    const rows = db
      .prepare(`select * from reminders where user_id = ? order by date asc, time asc`)
      .all(userId) as any[];

    let reminders = rows.map((r) => rowToReminder(db, r));

    if (filter?.types?.length) {
      reminders = reminders.filter((r) => filter.types!.some((t) => r.types.includes(t)));
    }
    if (filter?.status?.length) {
      reminders = reminders.filter((r) => filter.status!.includes(r.status));
    }
    if (filter?.search) {
      const q = filter.search.toLowerCase();
      reminders = reminders.filter(
        (r) =>
          r.title.toLowerCase().includes(q) ||
          (r.description ?? "").toLowerCase().includes(q)
      );
    }

    return reminders;
  }

  getReminder(id: string): Reminder | null {
    const db = getDb();
    const row = db.prepare(`select * from reminders where id = ?`).get(id) as any;
    if (!row) return null;
    return rowToReminder(db, row);
  }

  createReminder(userId: string, input: ReminderInput): Reminder {
    const db = getDb();
    const id = newId();
    const now = new Date().toISOString();

    const insertReminder = db.prepare(`
      insert into reminders (id, user_id, title, description, date, time, priority, notes, status, intensity, created_by_automation, created_at, updated_at)
      values (@id, @user_id, @title, @description, @date, @time, @priority, @notes, 'scheduled', @intensity, @created_by_automation, @created_at, @updated_at)
    `);

    const tx = db.transaction(() => {
      insertReminder.run({
        id,
        user_id: userId,
        title: input.title,
        description: input.description ?? null,
        date: input.date,
        time: input.time ?? null,
        priority: input.priority,
        notes: input.notes ?? null,
        intensity: input.intensity ?? "normal",
        created_by_automation: input.createdByAutomation ? 1 : 0,
        created_at: now,
        updated_at: now,
      });

      for (const channel of input.channels ?? []) {
        db.prepare(
          `insert or ignore into reminder_notification_channels (reminder_id, channel) values (?, ?)`
        ).run(id, channel);
      }

      for (const typeKey of input.types) {
        const typeRow = db.prepare(`select id from reminder_types where key = ?`).get(typeKey) as
          | { id: string }
          | undefined;
        if (!typeRow) continue;
        db.prepare(
          `insert or ignore into reminder_type_assignments (reminder_id, reminder_type_id) values (?, ?)`
        ).run(id, typeRow.id);
      }

      if (input.types.includes("payment") && input.payment) {
        db.prepare(`
          insert into payment_details (reminder_id, amount, currency, payee, account_last4, category, billing_date, due_date, autopay, paid_status)
          values (@reminder_id, @amount, @currency, @payee, @account_last4, @category, @billing_date, @due_date, @autopay, 'unpaid')
        `).run({
          reminder_id: id,
          amount: input.payment.amount ?? 0,
          currency: input.payment.currency ?? "USD",
          payee: input.payment.payee ?? null,
          account_last4: input.payment.account_last4 ?? null,
          category: input.payment.category ?? "other",
          billing_date: input.payment.billing_date ?? null,
          due_date: input.payment.due_date ?? input.date,
          autopay: input.payment.autopay ? 1 : 0,
        });
      }

      if (input.types.includes("call") && input.call) {
        db.prepare(
          `insert into call_details (reminder_id, contact_name, phone_number) values (?, ?, ?)`
        ).run(id, input.call.contact_name, input.call.phone_number ?? null);
      }

      if (input.types.includes("meeting") && input.meeting) {
        db.prepare(
          `insert into meeting_details (reminder_id, location, meeting_link, attendees) values (?, ?, ?, ?)`
        ).run(
          id,
          input.meeting.location ?? null,
          input.meeting.meeting_link ?? null,
          JSON.stringify(input.meeting.attendees ?? [])
        );
      }

      if (input.types.includes("follow_up") && input.follow_up) {
        db.prepare(
          `insert into follow_up_details (reminder_id, related_to, last_contacted_at) values (?, ?, ?)`
        ).run(id, input.follow_up.related_to ?? null, input.follow_up.last_contacted_at ?? null);
      }

      if (input.types.includes("recurring") && input.recurrence) {
        db.prepare(`
          insert into recurrence_rules (id, reminder_id, frequency, interval, by_day_of_month, by_month, by_weekday, ends_at, occurrences_limit)
          values (@rid, @reminder_id, @frequency, @interval, @by_day_of_month, @by_month, @by_weekday, @ends_at, @occurrences_limit)
        `).run({
          rid: newId(),
          reminder_id: id,
          frequency: input.recurrence.frequency ?? "monthly",
          interval: input.recurrence.interval ?? 1,
          by_day_of_month: input.recurrence.by_day_of_month ?? null,
          by_month: input.recurrence.by_month ?? null,
          by_weekday: input.recurrence.by_weekday ? JSON.stringify(input.recurrence.by_weekday) : null,
          ends_at: input.recurrence.ends_at ?? null,
          occurrences_limit: input.recurrence.occurrences_limit ?? null,
        });
      }

      // Initial occurrence: the reminder's own date/time.
      const scheduledFor = `${input.date}T${input.time ?? "09:00"}:00`;
      db.prepare(
        `insert into reminder_occurrences (id, reminder_id, scheduled_for, status) values (?, ?, ?, 'pending')`
      ).run(newId(), id, scheduledFor);

      db.prepare(
        `insert into reminder_history (id, reminder_id, action, detail, created_at) values (?, ?, 'created', ?, ?)`
      ).run(newId(), id, `Created with types: ${input.types.join(", ")}`, now);
    });

    tx();

    return this.getReminder(id)!;
  }

  updateReminderStatus(id: string, status: Reminder["status"]): void {
    const db = getDb();
    const now = new Date().toISOString();
    if (status === "completed") {
      db.prepare(`update reminders set status = ?, updated_at = ? where id = ?`).run(status, now, id);
    } else {
      db.prepare(
        `update reminders set status = ?, completed_at = null, updated_at = ? where id = ?`
      ).run(status, now, id);
    }
  }

  rescheduleReminder(id: string, date: string, time: string | null): void {
    const db = getDb();
    db.prepare(`update reminders set date = ?, time = ?, updated_at = ? where id = ?`).run(
      date,
      time,
      new Date().toISOString(),
      id
    );
  }

  completeReminder(id: string): Reminder | null {
    const db = getDb();
    const now = new Date().toISOString();
    const tx = db.transaction(() => {
      db.prepare(
        `update reminders set status = 'completed', completed_at = ?, updated_at = ? where id = ?`
      ).run(now, now, id);
      db.prepare(
        `update reminder_occurrences set status = 'acknowledged' where reminder_id = ? and status in ('pending','fired')`
      ).run(id);
      // DONE must immediately stop all future follow-up for every occurrence
      // of this reminder — not just the currently-firing one.
      db.prepare(
        `update reminder_occurrences
         set follow_up_state = 'completed', next_follow_up_at = null
         where reminder_id = ? and follow_up_state not in ('completed','cancelled')`
      ).run(id);
      db.prepare(
        `insert into reminder_history (id, reminder_id, action, detail, created_at) values (?, ?, 'completed', null, ?)`
      ).run(newId(), id, now);
    });
    tx();
    return this.getReminder(id);
  }

  snoozeReminder(id: string, minutes: number): Reminder | null {
    const db = getDb();
    const now = new Date();
    const nextFire = new Date(now.getTime() + minutes * 60_000).toISOString();

    const tx = db.transaction(() => {
      db.prepare(`update reminders set status = 'snoozed', updated_at = ? where id = ?`).run(
        now.toISOString(),
        id
      );
      // Snooze stops the CURRENT follow-up sequence...
      db.prepare(
        `update reminder_occurrences
         set status = 'cancelled', follow_up_state = 'cancelled', next_follow_up_at = null
         where reminder_id = ? and status = 'pending'`
      ).run(id);
      // ...and creates a fresh occurrence at the new time with an
      // independent, un-notified follow-up lifecycle (attempt count 0).
      db.prepare(
        `insert into reminder_occurrences (id, reminder_id, scheduled_for, status, follow_up_state) values (?, ?, ?, 'pending', 'pending')`
      ).run(newId(), id, nextFire);
      db.prepare(
        `insert into reminder_history (id, reminder_id, action, detail, created_at) values (?, ?, 'snoozed', ?, ?)`
      ).run(newId(), id, `Snoozed ${minutes}m`, now.toISOString());
    });
    tx();
    return this.getReminder(id);
  }

  listOccurrences(reminderId: string): ReminderOccurrence[] {
    const db = getDb();
    return db
      .prepare(`select * from reminder_occurrences where reminder_id = ? order by scheduled_for asc`)
      .all(reminderId)
      .map((r: any) => ({ ...r, escalated: !!r.escalated }));
  }

  listUpcomingOccurrences(userId: string): (ReminderOccurrence & { reminder: Reminder })[] {
    const db = getDb();
    const rows = db
      .prepare(
        `select o.* from reminder_occurrences o
         join reminders r on r.id = o.reminder_id
         where r.user_id = ? and o.status in ('pending','fired')
         order by o.scheduled_for asc`
      )
      .all(userId) as any[];

    return rows
      .map((row) => {
        const reminder = this.getReminder(row.reminder_id);
        if (!reminder) return null;
        return { ...row, escalated: !!row.escalated, reminder };
      })
      .filter(Boolean) as (ReminderOccurrence & { reminder: Reminder })[];
  }

  addOccurrence(reminderId: string, scheduledFor: string): ReminderOccurrence {
    const db = getDb();
    const id = newId();
    db.prepare(
      `insert into reminder_occurrences (id, reminder_id, scheduled_for, status) values (?, ?, ?, 'pending')`
    ).run(id, reminderId, scheduledFor);
    return db.prepare(`select * from reminder_occurrences where id = ?`).get(id) as ReminderOccurrence;
  }

  markOccurrenceNotified(occurrenceId: string, escalated: boolean): void {
    const db = getDb();
    db.prepare(
      `update reminder_occurrences
       set status = 'fired', fired_at = ?, repeat_count = repeat_count + 1, escalated = ?
       where id = ?`
    ).run(new Date().toISOString(), escalated ? 1 : 0, occurrenceId);
  }

  updateOccurrenceFollowUp(
    occurrenceId: string,
    fields: Partial<{
      follow_up_state: string;
      notification_attempt_count: number;
      escalation_level: number;
      last_notified_at: string | null;
      next_follow_up_at: string | null;
    }>
  ): void {
    const db = getDb();
    const columns = Object.keys(fields);
    if (columns.length === 0) return;
    const sets = columns.map((c) => `${c} = @${c}`).join(", ");
    db.prepare(`update reminder_occurrences set ${sets} where id = @id`).run({
      ...fields,
      id: occurrenceId,
    });
  }

  stopOccurrenceFollowUp(reminderId: string, state: "completed" | "cancelled"): void {
    const db = getDb();
    db.prepare(
      `update reminder_occurrences
       set follow_up_state = ?, next_follow_up_at = null
       where reminder_id = ? and follow_up_state not in ('completed','cancelled')`
    ).run(state, reminderId);
  }

  listHistory(reminderId: string): ReminderHistoryEntry[] {
    const db = getDb();
    return db
      .prepare(`select * from reminder_history where reminder_id = ? order by created_at desc`)
      .all(reminderId) as ReminderHistoryEntry[];
  }

  addHistory(
    reminderId: string,
    action: ReminderHistoryEntry["action"],
    detail?: string,
    occurrenceId?: string
  ): void {
    const db = getDb();
    db.prepare(
      `insert into reminder_history (id, reminder_id, action, detail, created_at, occurrence_id) values (?, ?, ?, ?, ?, ?)`
    ).run(newId(), reminderId, action, detail ?? null, new Date().toISOString(), occurrenceId ?? null);
  }

  upsertPushSubscription(
    userId: string,
    sub: { endpoint: string; p256dh: string; auth: string }
  ): PushSubscriptionRecord {
    const db = getDb();
    const now = new Date().toISOString();
    const existing = db
      .prepare(`select id from push_subscriptions where endpoint = ?`)
      .get(sub.endpoint) as { id: string } | undefined;

    if (existing) {
      db.prepare(
        `update push_subscriptions
         set user_id = ?, p256dh = ?, auth = ?, active = 1, failure_count = 0,
             last_failure_at = null, updated_at = ?
         where id = ?`
      ).run(userId, sub.p256dh, sub.auth, now, existing.id);
      return this.rowToPushSubscription(
        db.prepare(`select * from push_subscriptions where id = ?`).get(existing.id)
      );
    }

    const id = newId();
    db.prepare(
      `insert into push_subscriptions (id, user_id, endpoint, p256dh, auth, active, failure_count, created_at, updated_at)
       values (?, ?, ?, ?, ?, 1, 0, ?, ?)`
    ).run(id, userId, sub.endpoint, sub.p256dh, sub.auth, now, now);
    return this.rowToPushSubscription(db.prepare(`select * from push_subscriptions where id = ?`).get(id));
  }

  private rowToPushSubscription(row: any): PushSubscriptionRecord {
    return { ...row, active: !!row.active };
  }

  listActivePushSubscriptions(userId: string): PushSubscriptionRecord[] {
    const db = getDb();
    const rows = db
      .prepare(`select * from push_subscriptions where user_id = ? and active = 1`)
      .all(userId) as any[];
    return rows.map((r) => this.rowToPushSubscription(r));
  }

  deactivatePushSubscription(endpoint: string): void {
    const db = getDb();
    db.prepare(
      `update push_subscriptions set active = 0, updated_at = ? where endpoint = ?`
    ).run(new Date().toISOString(), endpoint);
  }

  recordPushFailure(endpoint: string): void {
    const db = getDb();
    db.prepare(
      `update push_subscriptions
       set failure_count = failure_count + 1, last_failure_at = ?, updated_at = ?
       where endpoint = ?`
    ).run(new Date().toISOString(), new Date().toISOString(), endpoint);
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
      default_amount: row.default_amount,
      minimum_amount: row.minimum_amount,
      autopay_enabled: !!row.autopay_enabled,
      reminder_enabled: !!row.reminder_enabled,
      escalation_enabled: !!row.escalation_enabled,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }

  private rowToPaymentCycle(row: any): PaymentCycle {
    return {
      id: row.id,
      payment_account_id: row.payment_account_id,
      cycle_period: row.cycle_period,
      statement_date: row.statement_date,
      due_date: row.due_date,
      amount: row.amount,
      minimum_amount: row.minimum_amount,
      status: row.status,
      paid_at: row.paid_at,
      reminder_id: row.reminder_id,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }

  listPaymentAccounts(userId: string): PaymentAccount[] {
    const db = getDb();
    return (
      db.prepare(`select * from payment_accounts where user_id = ? order by created_at desc`).all(userId) as any[]
    ).map((r) => this.rowToPaymentAccount(r));
  }

  getPaymentAccount(id: string): PaymentAccount | null {
    const db = getDb();
    const row = db.prepare(`select * from payment_accounts where id = ?`).get(id) as any;
    return row ? this.rowToPaymentAccount(row) : null;
  }

  createPaymentAccount(userId: string, input: PaymentAccountInput): PaymentAccount {
    const db = getDb();
    const id = newId();
    const now = new Date().toISOString();
    db.prepare(
      `insert into payment_accounts (
        id, user_id, name, payment_type, issuer, masked_identifier, active,
        statement_date_rule, due_date_rule, fixed_due_day, due_days_after_statement,
        default_amount, minimum_amount, autopay_enabled, reminder_enabled, escalation_enabled,
        created_at, updated_at
      ) values (@id, @user_id, @name, @payment_type, @issuer, @masked_identifier, @active,
        @statement_date_rule, @due_date_rule, @fixed_due_day, @due_days_after_statement,
        @default_amount, @minimum_amount, @autopay_enabled, @reminder_enabled, @escalation_enabled,
        @created_at, @updated_at)`
    ).run({
      id,
      user_id: userId,
      name: input.name,
      payment_type: input.payment_type,
      issuer: input.issuer ?? null,
      masked_identifier: input.masked_identifier ?? null,
      active: input.active ? 1 : 0,
      statement_date_rule: input.statement_date_rule,
      due_date_rule: input.due_date_rule,
      fixed_due_day: input.fixed_due_day ?? null,
      due_days_after_statement: input.due_days_after_statement ?? null,
      default_amount: input.default_amount,
      minimum_amount: input.minimum_amount ?? null,
      autopay_enabled: input.autopay_enabled ? 1 : 0,
      reminder_enabled: input.reminder_enabled ? 1 : 0,
      escalation_enabled: input.escalation_enabled ? 1 : 0,
      created_at: now,
      updated_at: now,
    });
    return this.getPaymentAccount(id)!;
  }

  updatePaymentAccount(id: string, update: PaymentAccountUpdate): PaymentAccount | null {
    const db = getDb();
    const existing = this.getPaymentAccount(id);
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

    const sets: string[] = [];
    const params: Record<string, unknown> = { id, updated_at: now };
    for (const [key, column] of Object.entries(columnMap)) {
      if (!(key in update)) continue;
      let value = (update as Record<string, unknown>)[key];
      if (typeof value === "boolean") value = value ? 1 : 0;
      sets.push(`${column} = @${column}`);
      params[column] = value;
    }
    if (sets.length) {
      db.prepare(`update payment_accounts set ${sets.join(", ")}, updated_at = @updated_at where id = @id`).run(
        params
      );
    }
    return this.getPaymentAccount(id);
  }

  setPaymentAccountActive(id: string, active: boolean): PaymentAccount | null {
    const db = getDb();
    db.prepare(`update payment_accounts set active = ?, updated_at = ? where id = ?`).run(
      active ? 1 : 0,
      new Date().toISOString(),
      id
    );
    return this.getPaymentAccount(id);
  }

  listPaymentCycles(accountId: string): PaymentCycle[] {
    const db = getDb();
    return (
      db
        .prepare(`select * from payment_cycles where payment_account_id = ? order by due_date desc`)
        .all(accountId) as any[]
    ).map((r) => this.rowToPaymentCycle(r));
  }

  getPaymentCycle(id: string): PaymentCycle | null {
    const db = getDb();
    const row = db.prepare(`select * from payment_cycles where id = ?`).get(id) as any;
    return row ? this.rowToPaymentCycle(row) : null;
  }

  getPaymentCycleByPeriod(accountId: string, cyclePeriod: string): PaymentCycle | null {
    const db = getDb();
    const row = db
      .prepare(`select * from payment_cycles where payment_account_id = ? and cycle_period = ?`)
      .get(accountId, cyclePeriod) as any;
    return row ? this.rowToPaymentCycle(row) : null;
  }

  createPaymentCycle(
    accountId: string,
    fields: { cyclePeriod: string; statementDate: string; dueDate: string; amount: number; minimumAmount: number | null }
  ): PaymentCycle {
    const db = getDb();
    // Idempotency: unique(payment_account_id, cycle_period) — "insert or
    // ignore" then re-read, so calling this twice for the same period never
    // creates a duplicate row and always returns the (single) real cycle.
    const id = newId();
    const now = new Date().toISOString();
    db.prepare(
      `insert or ignore into payment_cycles
        (id, payment_account_id, cycle_period, statement_date, due_date, amount, minimum_amount, status, created_at, updated_at)
       values (?, ?, ?, ?, ?, ?, ?, 'upcoming', ?, ?)`
    ).run(
      id,
      accountId,
      fields.cyclePeriod,
      fields.statementDate,
      fields.dueDate,
      fields.amount,
      fields.minimumAmount,
      now,
      now
    );
    return this.getPaymentCycleByPeriod(accountId, fields.cyclePeriod)!;
  }

  linkPaymentCycleReminder(cycleId: string, reminderId: string): void {
    const db = getDb();
    db.prepare(`update payment_cycles set reminder_id = ?, updated_at = ? where id = ?`).run(
      reminderId,
      new Date().toISOString(),
      cycleId
    );
  }

  updatePaymentCycleStatus(cycleId: string, status: PaymentCycle["status"]): void {
    const db = getDb();
    db.prepare(`update payment_cycles set status = ?, updated_at = ? where id = ? and status != 'paid'`).run(
      status,
      new Date().toISOString(),
      cycleId
    );
  }

  markPaymentCyclePaid(cycleId: string): PaymentCycle | null {
    const db = getDb();
    const existing = this.getPaymentCycle(cycleId);
    if (!existing) return null;
    // Idempotent: calling this twice on an already-paid cycle is a no-op.
    if (existing.status === "paid") return existing;
    const now = new Date().toISOString();
    const tx = db.transaction(() => {
      db.prepare(`update payment_cycles set status = 'paid', paid_at = ?, updated_at = ? where id = ?`).run(
        now,
        now,
        cycleId
      );
      // Reuse the EXISTING completeReminder path so the linked reminder's
      // occurrence follow_up_state becomes "completed" and all future
      // notifications stop — no new completion mechanism.
      if (existing.reminder_id) {
        this.completeReminder(existing.reminder_id);
      }
    });
    tx();
    return this.getPaymentCycle(cycleId);
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
      fired_at: row.fired_at,
    };
  }

  getLastProactiveNotification(
    userId: string,
    ruleId: string,
    subjectType: string,
    subjectId: string
  ): ProactiveNotificationRecord | null {
    const db = getDb();
    const row = db
      .prepare(
        `select * from proactive_notifications
         where user_id = ? and rule_id = ? and subject_type = ? and subject_id = ?
         order by fired_at desc limit 1`
      )
      .get(userId, ruleId, subjectType, subjectId) as any;
    return row ? this.rowToProactiveNotification(row) : null;
  }

  logProactiveNotification(args: {
    userId: string;
    ruleId: string;
    subjectType: "reminder" | "payment_cycle" | "cluster";
    subjectId: string;
    priority: "low" | "medium" | "high" | "urgent";
    channel: NotificationChannel | null;
    message: string;
    outcome: ProactiveNotificationOutcome;
  }): ProactiveNotificationRecord {
    const db = getDb();
    const id = newId();
    const now = new Date().toISOString();
    db.prepare(
      `insert into proactive_notifications (id, user_id, rule_id, subject_type, subject_id, priority, channel, message, outcome, fired_at)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      args.userId,
      args.ruleId,
      args.subjectType,
      args.subjectId,
      args.priority,
      args.channel,
      args.message,
      args.outcome,
      now
    );
    return this.rowToProactiveNotification(
      db.prepare(`select * from proactive_notifications where id = ?`).get(id)
    );
  }

  listProactiveNotifications(userId: string, limit = 50): ProactiveNotificationRecord[] {
    const db = getDb();
    return (
      db
        .prepare(`select * from proactive_notifications where user_id = ? order by fired_at desc limit ?`)
        .all(userId, limit) as any[]
    ).map((r) => this.rowToProactiveNotification(r));
  }

  // --- V11: Integrations + Automation ------------------------------------

  wasCreatedByAutomation(reminderId: string): boolean {
    const db = getDb();
    const row = db.prepare(`select created_by_automation from reminders where id = ?`).get(reminderId) as
      | { created_by_automation: number }
      | undefined;
    return !!row && row.created_by_automation === 1;
  }

  private rowToIntegrationAccount(row: any): IntegrationAccountRecord {
    return {
      id: row.id,
      user_id: row.user_id,
      provider: row.provider,
      status: row.status,
      access_token: row.access_token,
      refresh_token: row.refresh_token,
      expires_at: row.expires_at,
      connected_at: row.connected_at,
      last_sync_at: row.last_sync_at,
      last_error: row.last_error,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }

  getIntegrationAccount(userId: string, provider: IntegrationProvider): IntegrationAccountRecord | null {
    const db = getDb();
    const row = db
      .prepare(`select * from integration_accounts where user_id = ? and provider = ?`)
      .get(userId, provider) as any;
    return row ? this.rowToIntegrationAccount(row) : null;
  }

  upsertIntegrationAccount(
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
  ): IntegrationAccountRecord {
    const db = getDb();
    const existing = this.getIntegrationAccount(userId, provider);
    const now = new Date().toISOString();
    if (!existing) {
      const id = newId();
      db.prepare(
        `insert into integration_accounts
         (id, user_id, provider, status, access_token, refresh_token, expires_at, connected_at, last_sync_at, last_error, created_at, updated_at)
         values (@id, @user_id, @provider, @status, @access_token, @refresh_token, @expires_at, @connected_at, @last_sync_at, @last_error, @created_at, @updated_at)`
      ).run({
        id,
        user_id: userId,
        provider,
        status: fields.status ?? "not_connected",
        access_token: fields.access_token ?? null,
        refresh_token: fields.refresh_token ?? null,
        expires_at: fields.expires_at ?? null,
        connected_at: fields.connected_at ?? null,
        last_sync_at: fields.last_sync_at ?? null,
        last_error: fields.last_error ?? null,
        created_at: now,
        updated_at: now,
      });
      return this.getIntegrationAccount(userId, provider)!;
    }
    const merged = { ...existing, ...fields, updated_at: now };
    db.prepare(
      `update integration_accounts set status = @status, access_token = @access_token, refresh_token = @refresh_token,
       expires_at = @expires_at, connected_at = @connected_at, last_sync_at = @last_sync_at, last_error = @last_error,
       updated_at = @updated_at where id = @id`
    ).run({ ...merged, id: existing.id });
    return this.getIntegrationAccount(userId, provider)!;
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
      created_at: row.created_at,
      updated_at: row.updated_at,
      last_run_at: row.last_run_at,
    };
  }

  listAutomations(userId: string): AutomationRecord[] {
    const db = getDb();
    return (
      db.prepare(`select * from automations where user_id = ? order by created_at desc`).all(userId) as any[]
    ).map((r) => this.rowToAutomation(r));
  }

  getAutomation(id: string): AutomationRecord | null {
    const db = getDb();
    const row = db.prepare(`select * from automations where id = ?`).get(id) as any;
    return row ? this.rowToAutomation(row) : null;
  }

  createAutomation(userId: string, input: AutomationInput): AutomationRecord {
    const db = getDb();
    const id = newId();
    const now = new Date().toISOString();
    db.prepare(
      `insert into automations
       (id, user_id, name, trigger_type, trigger_config, condition_config, action_type, action_config, enabled, created_at, updated_at)
       values (@id, @user_id, @name, @trigger_type, @trigger_config, @condition_config, @action_type, @action_config, @enabled, @created_at, @updated_at)`
    ).run({
      id,
      user_id: userId,
      name: input.name,
      trigger_type: input.trigger_type,
      trigger_config: JSON.stringify(input.trigger_config ?? {}),
      condition_config: input.condition_config ? JSON.stringify(input.condition_config) : null,
      action_type: input.action_type,
      action_config: JSON.stringify(input.action_config),
      enabled: input.enabled === false ? 0 : 1,
      created_at: now,
      updated_at: now,
    });
    return this.getAutomation(id)!;
  }

  updateAutomation(
    id: string,
    changes: Partial<Pick<AutomationRecord, "name" | "enabled" | "trigger_config" | "condition_config" | "action_config">>
  ): AutomationRecord | null {
    const db = getDb();
    const existing = this.getAutomation(id);
    if (!existing) return null;
    const now = new Date().toISOString();
    const merged = {
      name: changes.name ?? existing.name,
      enabled: changes.enabled ?? existing.enabled,
      trigger_config: changes.trigger_config ?? existing.trigger_config,
      condition_config: changes.condition_config !== undefined ? changes.condition_config : existing.condition_config,
      action_config: changes.action_config ?? existing.action_config,
    };
    db.prepare(
      `update automations set name = @name, enabled = @enabled, trigger_config = @trigger_config,
       condition_config = @condition_config, action_config = @action_config, updated_at = @updated_at where id = @id`
    ).run({ ...merged, enabled: merged.enabled ? 1 : 0, updated_at: now, id });
    return this.getAutomation(id);
  }

  deleteAutomation(id: string): void {
    const db = getDb();
    db.prepare(`delete from automations where id = ?`).run(id);
  }

  touchAutomationLastRun(id: string, at: string): void {
    const db = getDb();
    db.prepare(`update automations set last_run_at = ? where id = ?`).run(at, id);
  }

  logAutomationRun(args: {
    automationId: string;
    triggerContext?: string | null;
    outcome: AutomationRunOutcome;
    detail?: string | null;
  }): AutomationRunRecord {
    const db = getDb();
    const id = newId();
    const now = new Date().toISOString();
    db.prepare(
      `insert into automation_runs (id, automation_id, triggered_at, trigger_context, outcome, detail, created_at)
       values (@id, @automation_id, @triggered_at, @trigger_context, @outcome, @detail, @created_at)`
    ).run({
      id,
      automation_id: args.automationId,
      triggered_at: now,
      trigger_context: args.triggerContext ?? null,
      outcome: args.outcome,
      detail: args.detail ?? null,
      created_at: now,
    });
    return db.prepare(`select * from automation_runs where id = ?`).get(id) as AutomationRunRecord;
  }

  listAutomationRuns(automationId: string, limit = 50): AutomationRunRecord[] {
    const db = getDb();
    return db
      .prepare(`select * from automation_runs where automation_id = ? order by triggered_at desc limit ?`)
      .all(automationId, limit) as AutomationRunRecord[];
  }
}

export const localDataLayer = new LocalDataLayer();
