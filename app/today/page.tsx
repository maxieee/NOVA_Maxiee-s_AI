import { db } from "@/lib/db";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatTile } from "@/components/dashboard/StatTile";
import { ReminderCard } from "@/components/reminders/ReminderCard";
import {
  computeDashboardCounts,
  getNeedsAttention,
  groupUpcomingByDay,
} from "@/lib/scheduling/urgency";
import { formatFriendlyDate } from "@/lib/utils/date";
import {
  greeting,
  todayStatLine,
  OVERDUE_HEADLINE,
  OVERDUE_SUBLINE,
  NOTHING_URGENT,
  UPCOMING_HEADLINE,
  UPCOMING_EMPTY,
  COMPLETED_HEADLINE,
  COMPLETED_EMPTY,
} from "@/lib/copy";

export const dynamic = "force-dynamic";

export default function TodayPage() {
  const userId = db.getCurrentUserId();
  const prefs = db.getPreferences(userId);
  const reminders = db.listReminders(userId);
  const now = new Date();

  const counts = computeDashboardCounts(reminders, now);
  const needsAttention = getNeedsAttention(reminders, now);
  const upcomingGroups = groupUpcomingByDay(reminders, now).slice(0, 5);
  const completedToday = reminders.filter(
    (r) =>
      (r.status === "completed" || r.status === "cancelled") &&
      r.completed_at &&
      new Date(r.completed_at).toDateString() === now.toDateString()
  );
  const displayName = prefs.preferred_name || prefs.display_name;

  function followUpFor(reminderId: string) {
    const occs = db.listOccurrences(reminderId);
    const latest = occs.filter((o) => o.follow_up_state !== "pending" && o.follow_up_state !== "due").pop();
    if (!latest) return null;
    return { state: latest.follow_up_state, lastNotifiedAt: latest.last_notified_at ?? null };
  }

  return (
    <div>
      <PageHeader
        title={greeting(displayName)}
        subtitle={`${todayStatLine(counts.urgent + counts.dueToday + counts.overdue)} · ${now.toLocaleDateString(
          undefined,
          { weekday: "long", month: "long", day: "numeric", year: "numeric" }
        )}`}
      />

      <div className="grid grid-cols-2 gap-3 px-4 pt-6 md:grid-cols-4 md:px-8">
        <StatTile label="Urgent" value={counts.urgent} icon="alarm-clock" tone="urgent" />
        <StatTile label="Due Today" value={counts.dueToday} icon="sun" tone="accent" />
        <StatTile label="Overdue" value={counts.overdue} icon="bell" tone="urgent" />
        <StatTile label="Completed" value={counts.completed} icon="check" tone="good" />
      </div>

      <section className="px-4 pt-8 md:px-8">
        <h2 className="mb-1 text-lg font-semibold text-nova-text">{OVERDUE_HEADLINE}</h2>
        {needsAttention.length > 0 && (
          <p className="mb-3 text-xs text-nova-muted">{OVERDUE_SUBLINE}</p>
        )}
        {needsAttention.length === 0 ? (
          <div className="nova-card p-6 text-center text-sm text-nova-muted">{NOTHING_URGENT}</div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {needsAttention.map((r) => (
              <ReminderCard key={r.id} reminder={r} now={now} followUp={followUpFor(r.id)} />
            ))}
          </div>
        )}
      </section>

      <section className="px-4 py-8 md:px-8">
        <h2 className="mb-3 text-lg font-semibold text-nova-text">{UPCOMING_HEADLINE}</h2>
        {upcomingGroups.length === 0 ? (
          <div className="nova-card p-6 text-center text-sm text-nova-muted">{UPCOMING_EMPTY}</div>
        ) : (
          <div className="flex flex-col gap-6">
            {upcomingGroups.map((group) => (
              <div key={group.date}>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-nova-muted">
                  {formatFriendlyDate(group.date)}
                </p>
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {group.items.map((r) => (
                    <ReminderCard key={r.id} reminder={r} now={now} followUp={followUpFor(r.id)} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="px-4 pb-10 md:px-8">
        <h2 className="mb-3 text-lg font-semibold text-nova-muted">{COMPLETED_HEADLINE}</h2>
        {completedToday.length === 0 ? (
          <div className="nova-card nova-completed p-6 text-center text-sm text-nova-muted">
            {COMPLETED_EMPTY}
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {completedToday.map((r) => (
              <div key={r.id} className="nova-completed rounded-2xl">
                <ReminderCard reminder={r} now={now} />
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
