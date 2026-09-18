import type Database from "better-sqlite3";
import { newId } from "@/lib/utils/id";
import { toISODate, addDays } from "@/lib/utils/date";

/** Seeds demo data the first time the local DB is created (idempotent). */
export function seedIfEmpty(db: Database.Database) {
  const userCount = (db.prepare(`select count(*) as c from users`).get() as { c: number }).c;
  if (userCount > 0) return;

  const userId = newId();
  const now = new Date().toISOString();

  db.prepare(
    `insert into users (id, email, display_name, created_at) values (?, ?, ?, ?)`
  ).run(userId, "you@example.com", "You", now);

  db.prepare(
    `insert into user_preferences (user_id, reminder_lead_days, repeat_interval_minutes, escalation_enabled, theme, updated_at)
     values (?, '[7,3,1]', 120, 1, 'dark', ?)`
  ).run(userId, now);

  const types = [
    ["task", "Task", "check-square", "#6366f1"],
    ["payment", "Payment", "credit-card", "#f59e0b"],
    ["call", "Call", "phone", "#22d3ee"],
    ["meeting", "Meeting", "users", "#8b5cf6"],
    ["follow_up", "Follow-up", "repeat", "#ec4899"],
    ["important_date", "Important Date", "star", "#f43f5e"],
    ["general", "General Reminder", "bell", "#8b93a3"],
    ["recurring", "Recurring Reminder", "refresh-cw", "#22c55e"],
  ] as const;

  const typeIds: Record<string, string> = {};
  for (const [key, label, icon, color] of types) {
    const id = newId();
    typeIds[key] = id;
    db.prepare(
      `insert into reminder_types (id, key, label, icon, color) values (?, ?, ?, ?, ?)`
    ).run(id, key, label, icon, color);
  }

  const today = new Date();

  function assignTypes(reminderId: string, keys: string[]) {
    for (const k of keys) {
      db.prepare(
        `insert into reminder_type_assignments (reminder_id, reminder_type_id) values (?, ?)`
      ).run(reminderId, typeIds[k]);
    }
  }

  function makeReminder(opts: {
    title: string;
    description?: string;
    date: Date;
    time?: string;
    priority: "low" | "medium" | "high" | "urgent";
    notes?: string;
    types: string[];
    status?: string;
  }) {
    const id = newId();
    db.prepare(
      `insert into reminders (id, user_id, title, description, date, time, priority, notes, status, created_at, updated_at)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      userId,
      opts.title,
      opts.description ?? null,
      toISODate(opts.date),
      opts.time ?? "09:00",
      opts.priority,
      opts.notes ?? null,
      opts.status ?? "scheduled",
      now,
      now
    );
    assignTypes(id, opts.types);
    db.prepare(
      `insert into reminder_occurrences (id, reminder_id, scheduled_for, status) values (?, ?, ?, ?)`
    ).run(
      newId(),
      id,
      `${toISODate(opts.date)}T${opts.time ?? "09:00"}:00`,
      opts.status === "completed" ? "acknowledged" : "pending"
    );
    db.prepare(
      `insert into reminder_history (id, reminder_id, action, detail, created_at) values (?, ?, 'created', 'Seeded demo data', ?)`
    ).run(newId(), id, now);
    return id;
  }

  // 1. Overdue payment + recurring (credit card bill)
  const ccId = makeReminder({
    title: "Pay Chase Credit Card",
    description: "Minimum payment due to avoid late fee",
    date: addDays(today, -2),
    time: "09:00",
    priority: "urgent",
    types: ["payment", "recurring"],
  });
  db.prepare(
    `insert into payment_details (reminder_id, amount, currency, payee, account_last4, category, billing_date, due_date, autopay, paid_status)
     values (?, ?, 'USD', ?, ?, 'credit_card', ?, ?, 0, 'overdue')`
  ).run(ccId, 428.5, "Chase Bank", "4821", toISODate(addDays(today, -16)), toISODate(addDays(today, -2)));
  db.prepare(
    `insert into recurrence_rules (id, reminder_id, frequency, interval, by_day_of_month) values (?, ?, 'monthly', 1, ?)`
  ).run(newId(), ccId, addDays(today, -2).getDate());

  // 2. Due today: rent EMI, payment + important date
  const emiId = makeReminder({
    title: "Home Loan EMI",
    description: "Auto-debit scheduled, verify balance",
    date: today,
    time: "08:00",
    priority: "high",
    types: ["payment", "important_date", "recurring"],
  });
  db.prepare(
    `insert into payment_details (reminder_id, amount, currency, payee, account_last4, category, billing_date, due_date, autopay, paid_status)
     values (?, ?, 'USD', ?, ?, 'emi', ?, ?, 1, 'unpaid')`
  ).run(emiId, 1240, "HDFC Home Loans", "9012", toISODate(addDays(today, -5)), toISODate(today));
  db.prepare(
    `insert into recurrence_rules (id, reminder_id, frequency, interval, by_day_of_month) values (?, ?, 'monthly', 1, ?)`
  ).run(newId(), emiId, today.getDate());

  // 3. Due today: Call mom, call type only
  const callId = makeReminder({
    title: "Call Mom",
    description: "Weekly check-in call",
    date: today,
    time: "18:00",
    priority: "medium",
    types: ["call", "recurring"],
  });
  db.prepare(`insert into call_details (reminder_id, contact_name, phone_number) values (?, ?, ?)`).run(
    callId,
    "Mom",
    "+1 555-010-2938"
  );
  db.prepare(
    `insert into recurrence_rules (id, reminder_id, frequency, interval, by_weekday) values (?, ?, 'weekly', 1, ?)`
  ).run(newId(), callId, JSON.stringify([today.getDay()]));

  // 4. Upcoming: team meeting, meeting + task
  const meetingId = makeReminder({
    title: "Quarterly Planning Meeting",
    description: "Prepare slides beforehand",
    date: addDays(today, 2),
    time: "14:00",
    priority: "high",
    types: ["meeting", "task"],
  });
  db.prepare(
    `insert into meeting_details (reminder_id, location, meeting_link, attendees) values (?, ?, ?, ?)`
  ).run(meetingId, "Conference Room B", "https://meet.example.com/q-planning", JSON.stringify(["Alex", "Priya", "Sam"]));

  // 5. Upcoming: follow up with client, follow_up + task
  const followId = makeReminder({
    title: "Follow up with Acme Corp",
    description: "Check on proposal status",
    date: addDays(today, 3),
    time: "11:00",
    priority: "medium",
    types: ["follow_up", "task"],
  });
  db.prepare(
    `insert into follow_up_details (reminder_id, related_to, last_contacted_at) values (?, ?, ?)`
  ).run(followId, "Acme Corp proposal", toISODate(addDays(today, -4)));

  // 6. Upcoming: subscription payment, recurring
  const subId = makeReminder({
    title: "Netflix Subscription",
    description: "Monthly subscription renewal",
    date: addDays(today, 5),
    time: "09:00",
    priority: "low",
    types: ["payment", "recurring"],
  });
  db.prepare(
    `insert into payment_details (reminder_id, amount, currency, payee, account_last4, category, billing_date, due_date, autopay, paid_status)
     values (?, ?, 'USD', ?, ?, 'subscription', ?, ?, 1, 'unpaid')`
  ).run(subId, 15.99, "Netflix", "4821", toISODate(addDays(today, 5)), toISODate(addDays(today, 5)));
  db.prepare(
    `insert into recurrence_rules (id, reminder_id, frequency, interval, by_day_of_month) values (?, ?, 'monthly', 1, ?)`
  ).run(newId(), subId, addDays(today, 5).getDate());

  // 7. Upcoming: anniversary, important date + general
  makeReminder({
    title: "Wedding Anniversary",
    description: "Book dinner reservation",
    date: addDays(today, 10),
    time: "19:00",
    priority: "high",
    types: ["important_date", "general"],
  });

  // 8. Completed: gym membership payment (history example)
  const doneId = makeReminder({
    title: "Gym Membership Renewal",
    description: "Annual renewal, already paid",
    date: addDays(today, -10),
    time: "09:00",
    priority: "low",
    types: ["payment"],
    status: "completed",
  });
  db.prepare(
    `insert into payment_details (reminder_id, amount, currency, payee, account_last4, category, billing_date, due_date, autopay, paid_status)
     values (?, ?, 'USD', ?, ?, 'subscription', ?, ?, 0, 'paid')`
  ).run(doneId, 349, "FitLife Gym", "7765", toISODate(addDays(today, -14)), toISODate(addDays(today, -10)));
  db.prepare(
    `update reminders set completed_at = ? where id = ?`
  ).run(toISODate(addDays(today, -9)), doneId);

  // 9. Task-only, due today, simple general reminder
  makeReminder({
    title: "Submit expense report",
    description: "Q3 travel expenses",
    date: today,
    time: "17:00",
    priority: "medium",
    types: ["task"],
  });

  // 10. Overdue task+follow-up combo
  makeReminder({
    title: "Send contract to legal",
    description: "Client contract review",
    date: addDays(today, -1),
    time: "12:00",
    priority: "urgent",
    types: ["task", "follow_up"],
  });
}
