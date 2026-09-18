import type {
  Reminder,
  ReminderOccurrence,
  ReminderHistoryEntry,
  NotificationLogEntry,
  NotificationOutcome,
  PaymentCycle,
  ProactiveNotificationRecord,
  AutomationRunRecord,
} from "@/types/reminder";

/**
 * Pure, side-effect free metric computation over already-fetched data.
 * No DB access here — mirrors the style of lib/scheduling/urgency.ts and
 * lib/proactive/engine.ts (pure functions + one thin fetch/orchestration
 * layer in lib/db). Every number here is derived strictly from what is
 * already persisted; nothing is fabricated or extrapolated beyond the
 * sample actually available.
 */

export interface CompletionMetrics {
  createdCount: number;
  completedCount: number;
  /** null when createdCount is 0 — never divide by zero into a fake 0%. */
  completionRate: number | null;
  /** Average hours from created_at to completed_at, null if no completions with both timestamps. */
  avgTimeToCompletionHours: number | null;
  overdueCount: number;
}

export function computeCompletionMetrics(reminders: Reminder[], now: Date = new Date()): CompletionMetrics {
  const createdCount = reminders.length;
  const completed = reminders.filter((r) => r.status === "completed" && r.completed_at);
  const completedCount = completed.length;

  let avgTimeToCompletionHours: number | null = null;
  if (completedCount > 0) {
    const totalHours = completed.reduce((sum, r) => {
      const created = new Date(r.created_at).getTime();
      const done = new Date(r.completed_at as string).getTime();
      return sum + Math.max(0, done - created) / 3_600_000;
    }, 0);
    avgTimeToCompletionHours = totalHours / completedCount;
  }

  const overdueCount = reminders.filter((r) => {
    if (r.status === "completed" || r.status === "cancelled") return false;
    if (!r.time) return false;
    const due = new Date(`${r.date}T${r.time}:00`);
    return due.getTime() < now.getTime();
  }).length;

  return {
    createdCount,
    completedCount,
    completionRate: createdCount > 0 ? completedCount / createdCount : null,
    avgTimeToCompletionHours,
    overdueCount,
  };
}

export interface SnoozePattern {
  reminderId: string;
  title: string;
  snoozeCount: number;
  /** Hour-of-day (0-23) each snooze's resulting occurrence was rescheduled to, in order. */
  resultingHours: number[];
}

export interface SnoozeMetrics {
  totalSnoozes: number;
  perReminder: SnoozePattern[];
  /** Count of snoozes whose resulting occurrence lands in each hour of day, index 0-23. */
  byHourOfDay: number[];
}

export function computeSnoozeMetrics(
  reminders: Reminder[],
  occurrences: ReminderOccurrence[],
  history: ReminderHistoryEntry[]
): SnoozeMetrics {
  const snoozeEvents = history.filter((h) => h.action === "snoozed");
  const byHourOfDay = new Array(24).fill(0) as number[];
  const perReminderMap = new Map<string, SnoozePattern>();
  const titleById = new Map(reminders.map((r) => [r.id, r.title]));

  // Occurrences created by a snooze are the ones with repeat_count === 0 and
  // status pending/fired that are NOT the very first occurrence — we don't
  // have a direct FK from history to occurrence, so approximate using the
  // occurrence(s) recorded for the reminder at/after each snooze event's
  // timestamp (best-effort, real-data-only; no fabricated linkage).
  for (const event of snoozeEvents) {
    const existing = perReminderMap.get(event.reminder_id) ?? {
      reminderId: event.reminder_id,
      title: titleById.get(event.reminder_id) ?? "(deleted reminder)",
      snoozeCount: 0,
      resultingHours: [],
    };
    existing.snoozeCount += 1;

    const eventTime = new Date(event.created_at).getTime();
    const candidate = occurrences
      .filter((o) => o.reminder_id === event.reminder_id && new Date(o.scheduled_for).getTime() >= eventTime)
      .sort((a, b) => new Date(a.scheduled_for).getTime() - new Date(b.scheduled_for).getTime())[0];

    if (candidate) {
      const hour = new Date(candidate.scheduled_for).getHours();
      existing.resultingHours.push(hour);
      byHourOfDay[hour] += 1;
    }

    perReminderMap.set(event.reminder_id, existing);
  }

  return {
    totalSnoozes: snoozeEvents.length,
    perReminder: [...perReminderMap.values()].sort((a, b) => b.snoozeCount - a.snoozeCount),
    byHourOfDay,
  };
}

export interface NotificationBreakdown {
  byChannel: Record<string, Record<NotificationOutcome, number>>;
  totalsByOutcome: Record<NotificationOutcome, number>;
  totalAttempts: number;
}

export function computeNotificationBreakdown(notifications: NotificationLogEntry[]): NotificationBreakdown {
  const byChannel: Record<string, Record<NotificationOutcome, number>> = {};
  const totalsByOutcome: Record<NotificationOutcome, number> = {
    sent: 0,
    failed: 0,
    not_configured: 0,
    invalid_number: 0,
  };

  for (const n of notifications) {
    const outcome = (n.outcome ?? "sent") as NotificationOutcome;
    if (!byChannel[n.channel]) {
      byChannel[n.channel] = { sent: 0, failed: 0, not_configured: 0, invalid_number: 0 };
    }
    byChannel[n.channel][outcome] += 1;
    totalsByOutcome[outcome] += 1;
  }

  return { byChannel, totalsByOutcome, totalAttempts: notifications.length };
}

export interface PaymentTimingMetrics {
  sampleSize: number;
  avgDaysFromFirstNotificationToPaid: number | null;
}

/** Minimum number of paid cycles with a matched first-notification timestamp before we call anything a "usual" pattern. */
export const MIN_PAYMENT_TIMING_SAMPLE = 3;

export function computePaymentTimingMetrics(
  paymentCycles: PaymentCycle[],
  notifications: NotificationLogEntry[]
): PaymentTimingMetrics {
  const samples: number[] = [];

  for (const cycle of paymentCycles) {
    if (cycle.status !== "paid" || !cycle.paid_at || !cycle.reminder_id) continue;
    const cycleNotifications = notifications
      .filter((n) => n.reminder_id === cycle.reminder_id)
      .sort((a, b) => new Date(a.sent_at).getTime() - new Date(b.sent_at).getTime());
    const first = cycleNotifications[0];
    if (!first) continue;
    const days = (new Date(cycle.paid_at).getTime() - new Date(first.sent_at).getTime()) / 86_400_000;
    if (days >= 0) samples.push(days);
  }

  return {
    sampleSize: samples.length,
    avgDaysFromFirstNotificationToPaid:
      samples.length >= MIN_PAYMENT_TIMING_SAMPLE ? samples.reduce((a, b) => a + b, 0) / samples.length : null,
  };
}

export interface RecurringMissRate {
  reminderId: string;
  title: string;
  totalOccurrences: number;
  missedOccurrences: number;
  missRate: number;
}

/** Minimum real occurrences recorded for a reminder before its miss rate is reported. */
export const MIN_OCCURRENCES_FOR_MISS_RATE = 3;

export function computeRecurringMissRates(
  reminders: Reminder[],
  occurrences: ReminderOccurrence[]
): RecurringMissRate[] {
  const titleById = new Map(reminders.map((r) => [r.id, r.title]));
  const byReminder = new Map<string, ReminderOccurrence[]>();
  for (const o of occurrences) {
    const list = byReminder.get(o.reminder_id) ?? [];
    list.push(o);
    byReminder.set(o.reminder_id, list);
  }

  const results: RecurringMissRate[] = [];
  for (const [reminderId, list] of byReminder) {
    if (list.length < MIN_OCCURRENCES_FOR_MISS_RATE) continue;
    const missed = list.filter((o) => o.status === "missed").length;
    results.push({
      reminderId,
      title: titleById.get(reminderId) ?? "(deleted reminder)",
      totalOccurrences: list.length,
      missedOccurrences: missed,
      missRate: missed / list.length,
    });
  }

  return results.sort((a, b) => b.missRate - a.missRate);
}

export interface ProactiveActivityMetrics {
  totalFired: number;
  byRule: Record<string, number>;
}

export function computeProactiveActivity(records: ProactiveNotificationRecord[]): ProactiveActivityMetrics {
  const byRule: Record<string, number> = {};
  for (const r of records) {
    byRule[r.rule_id] = (byRule[r.rule_id] ?? 0) + 1;
  }
  return { totalFired: records.length, byRule };
}

export interface AutomationActivityMetrics {
  totalRuns: number;
  byOutcome: Record<string, number>;
  byAutomation: { automationId: string; name: string; runs: number; successes: number }[];
}

export function computeAutomationActivity(
  runs: (AutomationRunRecord & { automation_name: string })[]
): AutomationActivityMetrics {
  const byOutcome: Record<string, number> = {};
  const byAutomationMap = new Map<string, { automationId: string; name: string; runs: number; successes: number }>();

  for (const run of runs) {
    byOutcome[run.outcome] = (byOutcome[run.outcome] ?? 0) + 1;
    const entry = byAutomationMap.get(run.automation_id) ?? {
      automationId: run.automation_id,
      name: run.automation_name,
      runs: 0,
      successes: 0,
    };
    entry.runs += 1;
    if (run.outcome === "success") entry.successes += 1;
    byAutomationMap.set(run.automation_id, entry);
  }

  return { totalRuns: runs.length, byOutcome, byAutomation: [...byAutomationMap.values()] };
}
