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

export const dynamic = "force-dynamic";

function greeting(name: string): string {
  const hour = new Date().getHours();
  const part = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  return `${part}, ${name}`;
}

export default function TodayPage() {
  const userId = db.getCurrentUserId();
  const prefs = db.getPreferences(userId);
  const reminders = db.listReminders(userId);
  const now = new Date();

  const counts = computeDashboardCounts(reminders, now);
  const needsAttention = getNeedsAttention(reminders, now);
  const upcomingGroups = groupUpcomingByDay(reminders, now).slice(0, 5);

  return (
    <div>
      <PageHeader
        title={greeting(prefs.display_name)}
        subtitle={now.toLocaleDateString(undefined, {
          weekday: "long",
          month: "long",
          day: "numeric",
          year: "numeric",
        })}
      />

      <div className="grid grid-cols-2 gap-3 px-4 pt-6 md:grid-cols-4 md:px-8">
        <StatTile label="Urgent" value={counts.urgent} icon="alarm-clock" tone="urgent" />
        <StatTile label="Due Today" value={counts.dueToday} icon="sun" tone="accent" />
        <StatTile label="Overdue" value={counts.overdue} icon="bell" tone="warn" />
        <StatTile label="Completed" value={counts.completed} icon="check" tone="good" />
      </div>

      <section className="px-4 pt-8 md:px-8">
        <h2 className="mb-3 text-lg font-semibold text-white">Needs Attention</h2>
        {needsAttention.length === 0 ? (
          <div className="nova-card p-6 text-center text-sm text-nova-muted">
            Nothing urgent right now. Nice work.
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {needsAttention.map((r) => (
              <ReminderCard key={r.id} reminder={r} now={now} />
            ))}
          </div>
        )}
      </section>

      <section className="px-4 py-8 md:px-8">
        <h2 className="mb-3 text-lg font-semibold text-white">Upcoming</h2>
        {upcomingGroups.length === 0 ? (
          <div className="nova-card p-6 text-center text-sm text-nova-muted">
            Nothing scheduled beyond today.
          </div>
        ) : (
          <div className="flex flex-col gap-6">
            {upcomingGroups.map((group) => (
              <div key={group.date}>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-nova-muted">
                  {formatFriendlyDate(group.date)}
                </p>
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {group.items.map((r) => (
                    <ReminderCard key={r.id} reminder={r} now={now} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
