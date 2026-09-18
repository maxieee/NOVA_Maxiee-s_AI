import { db } from "@/lib/db";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatTile } from "@/components/dashboard/StatTile";
import { ReminderCard } from "@/components/reminders/ReminderCard";
import { PaymentTodayCard } from "@/components/dashboard/PaymentTodayCard";
import { buildTodayViewModel, type TodayItem } from "@/lib/scheduling/todayIntelligence";
import { formatFriendlyDate } from "@/lib/utils/date";
import type { PaymentCycle } from "@/types/reminder";
import {
  greeting,
  todayStatLine,
  unifiedTodayLine,
  PAYMENTS_DUE_LABEL,
  OVERDUE_HEADLINE,
  OVERDUE_SUBLINE,
  NOTHING_URGENT,
  UPCOMING_HEADLINE,
  UPCOMING_EMPTY,
  COMPLETED_HEADLINE,
  COMPLETED_EMPTY,
} from "@/lib/copy";

export const dynamic = "force-dynamic";

export default async function TodayPage() {
  const userId = await db.getCurrentUserId();
  const prefs = await db.getPreferences(userId);
  const reminders = await db.listReminders(userId);
  const paymentAccounts = await db.listPaymentAccounts(userId);
  const now = new Date();

  const cyclesByAccount = new Map<string, PaymentCycle[]>();
  for (const account of paymentAccounts) {
    cyclesByAccount.set(account.id, await db.listPaymentCycles(account.id));
  }

  const view = buildTodayViewModel(reminders, paymentAccounts, cyclesByAccount, now);
  const displayName = prefs.preferred_name || prefs.display_name;

  const followUpByReminder = new Map<string, { state: import("@/types/reminder").FollowUpState; lastNotifiedAt: string | null }>();
  for (const reminder of reminders) {
    const occs = await db.listOccurrences(reminder.id);
    const latest = occs.filter((o) => o.follow_up_state !== "pending" && o.follow_up_state !== "due").pop();
    if (latest) {
      followUpByReminder.set(reminder.id, { state: latest.follow_up_state, lastNotifiedAt: latest.last_notified_at ?? null });
    }
  }
  function followUpFor(reminderId: string) {
    return followUpByReminder.get(reminderId) ?? null;
  }

  function renderItem(item: TodayItem) {
    if (item.source === "payment" && item.payment) {
      return (
        <PaymentTodayCard
          key={`payment-${item.id}`}
          account={item.payment.account}
          cycle={item.payment.cycle}
          bucket={item.bucket}
        />
      );
    }
    if (item.reminder) {
      return (
        <ReminderCard key={`reminder-${item.id}`} reminder={item.reminder} now={now} followUp={followUpFor(item.id)} />
      );
    }
    return null;
  }

  const totalHandleToday = view.counts.urgent + view.counts.dueToday + view.counts.overdue;
  const unifiedLine = unifiedTodayLine(totalHandleToday, view.counts.paymentsDueSoon);

  return (
    <div>
      <PageHeader
        title={greeting(displayName)}
        subtitle={`${todayStatLine(totalHandleToday)}${unifiedLine ? ` ${unifiedLine}` : ""} · ${now.toLocaleDateString(
          undefined,
          { weekday: "long", month: "long", day: "numeric", year: "numeric" }
        )}`}
      />

      <div className="grid grid-cols-2 gap-3 px-4 pt-6 md:grid-cols-4 md:px-8">
        <StatTile label="Urgent" value={view.counts.urgent} icon="alarm-clock" tone="urgent" />
        <StatTile label="Due Today" value={view.counts.dueToday} icon="sun" tone="accent" />
        <StatTile label="Overdue" value={view.counts.overdue} icon="bell" tone="urgent" />
        <StatTile label={PAYMENTS_DUE_LABEL} value={view.counts.paymentsDueSoon} icon="credit-card" tone="warn" />
      </div>

      <section className="px-4 pt-8 md:px-8">
        <h2 className="mb-1 text-lg font-semibold text-nova-text">{OVERDUE_HEADLINE}</h2>
        {view.needsAttention.length > 0 && (
          <p className="mb-3 text-xs text-nova-muted">{OVERDUE_SUBLINE}</p>
        )}
        {view.needsAttention.length === 0 ? (
          <div className="nova-card p-6 text-center text-sm text-nova-muted">{NOTHING_URGENT}</div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {view.needsAttention.map(renderItem)}
          </div>
        )}
      </section>

      <section className="px-4 py-8 md:px-8">
        <h2 className="mb-3 text-lg font-semibold text-nova-text">{UPCOMING_HEADLINE}</h2>
        {view.upcoming.length === 0 ? (
          <div className="nova-card p-6 text-center text-sm text-nova-muted">{UPCOMING_EMPTY}</div>
        ) : (
          <div className="flex flex-col gap-6">
            {view.upcoming.slice(0, 5).map((group) => (
              <div key={group.date}>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-nova-muted">
                  {formatFriendlyDate(group.date)}
                </p>
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {group.items.map(renderItem)}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="px-4 pb-10 md:px-8">
        <h2 className="mb-3 text-lg font-semibold text-nova-muted">{COMPLETED_HEADLINE}</h2>
        {view.completedToday.length === 0 ? (
          <div className="nova-card nova-completed p-6 text-center text-sm text-nova-muted">
            {COMPLETED_EMPTY}
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {view.completedToday.map((item) => (
              <div key={`${item.source}-${item.id}`} className="nova-completed rounded-2xl">
                {item.source === "payment" && item.payment ? (
                  <PaymentTodayCard account={item.payment.account} cycle={item.payment.cycle} bucket={item.bucket} />
                ) : item.reminder ? (
                  <ReminderCard reminder={item.reminder} now={now} />
                ) : null}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
