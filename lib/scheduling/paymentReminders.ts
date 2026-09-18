import { db } from "@/lib/db";
import { computeLeadTimeSchedule } from "@/lib/scheduling/recurrence";
import { DEFAULT_PAYMENT_LEAD_TIMES } from "@/lib/scheduling/paymentReminderConfig";
import { toISODate } from "@/lib/utils/date";
import type { NotificationChannel, PaymentAccount, PaymentCycle, PaymentDetails, Reminder } from "@/types/reminder";

function categoryFor(paymentType: PaymentAccount["payment_type"]): PaymentDetails["category"] {
  switch (paymentType) {
    case "CREDIT_CARD":
      return "credit_card";
    case "EMI":
      return "emi";
    case "BILL":
      return "bill";
    case "SUBSCRIPTION":
      return "subscription";
    default:
      return "other";
  }
}

/**
 * For a single payment_cycle without a linked reminder, creates the
 * ordinary NOVA reminder (type "payment") that the EXISTING engine
 * (dueScan / decideFollowUp / providers) then handles unmodified, with
 * occurrences at the account's configured lead times (default 7/3/1 days
 * before due + due date itself). Linking payment_cycles.reminder_id makes
 * this a no-op on any re-run for the same cycle.
 *
 * Returns null when the account has reminders disabled (reminder_enabled
 * = false) — the cycle then simply has no reminder, by design.
 */
export async function generateReminderForCycle(
  cycle: PaymentCycle,
  account: PaymentAccount,
  userId: string,
  preferredChannels: NotificationChannel[],
  defaultIntensity: Reminder["intensity"]
): Promise<Reminder | null> {
  if (cycle.reminder_id) {
    return await db.getReminder(cycle.reminder_id);
  }
  if (!account.reminder_enabled) {
    return null;
  }

  const dueDate = new Date(`${cycle.due_date}T00:00:00`);
  const leadDays = DEFAULT_PAYMENT_LEAD_TIMES.map((l) => l.daysBeforeDue);
  const schedule = computeLeadTimeSchedule(dueDate, leadDays); // sorted ascending, includes due-date morning

  // Channels: escalation (sms/call) only ever considered when the account
  // explicitly enables it — reusing whichever channels the person has
  // actually configured (V4's rule: being due/a payment is never itself a
  // reason to call).
  const channels: NotificationChannel[] = account.escalation_enabled
    ? preferredChannels.length
      ? preferredChannels
      : ["push"]
    : (preferredChannels.filter((c) => c !== "call" && c !== "sms").length
        ? preferredChannels.filter((c) => c !== "call" && c !== "sms")
        : ["push"]);

  const firstFire = schedule[0] ?? dueDate;

  const reminder = await db.createReminder(userId, {
    title: `${account.name} payment due`,
    description: account.issuer ? `${account.issuer} — ${account.name}` : account.name,
    date: toISODate(firstFire),
    time: `${String(firstFire.getHours()).padStart(2, "0")}:${String(firstFire.getMinutes()).padStart(2, "0")}`,
    priority: "high",
    types: ["payment"],
    payment: {
      amount: cycle.amount,
      currency: "USD",
      payee: account.issuer ?? account.name,
      account_last4: account.masked_identifier ?? null,
      category: categoryFor(account.payment_type),
      billing_date: cycle.statement_date,
      due_date: cycle.due_date,
      autopay: account.autopay_enabled,
    },
    channels,
    intensity: defaultIntensity,
  });

  // Additional lead-time / due-date occurrences beyond the first, which
  // createReminder already scheduled.
  for (const fireAt of schedule.slice(1)) {
    await db.addOccurrence(reminder.id, fireAt.toISOString());
  }

  await db.linkPaymentCycleReminder(cycle.id, reminder.id);
  await db.addHistory(reminder.id, "created", `Generated from payment cycle ${cycle.cycle_period} for ${account.name}`);

  return await db.getReminder(reminder.id);
}

/** Generates reminders for every cycle (of every active account) that lacks one — idempotent per cycle. */
export async function generateMissingReminders(
  userId: string,
  preferredChannels: NotificationChannel[],
  defaultIntensity: Reminder["intensity"]
): Promise<void> {
  const accounts = await db.listPaymentAccounts(userId);
  for (const account of accounts) {
    for (const cycle of await db.listPaymentCycles(account.id)) {
      if (!cycle.reminder_id) {
        await generateReminderForCycle(cycle, account, userId, preferredChannels, defaultIntensity);
      }
    }
  }
}
