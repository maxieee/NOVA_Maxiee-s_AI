import { db } from "@/lib/db";
import { PageHeader } from "@/components/ui/PageHeader";
import { Icon } from "@/components/ui/Icon";
import Link from "next/link";

export const dynamic = "force-dynamic";

const ACTION_ICON: Record<string, string> = {
  created: "plus",
  updated: "refresh-cw",
  notified: "bell",
  snoozed: "alarm-clock",
  completed: "check",
  cancelled: "x",
  escalated: "star",
};

export default async function HistoryPage() {
  const userId = await db.getCurrentUserId();
  const reminders = await db.listReminders(userId);

  const historyByReminder = await Promise.all(
    reminders.map(async (r) => (await db.listHistory(r.id)).map((h) => ({ ...h, reminder: r })))
  );
  const entries = historyByReminder
    .flat()
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  return (
    <div>
      <PageHeader title="History" subtitle="A full audit trail of every reminder action" />

      <section className="px-4 py-6 md:px-8">
        <div className="nova-card divide-y divide-nova-border">
          {entries.map((e) => (
            <Link
              key={e.id}
              href={`/reminders/${e.reminder.id}`}
              className="flex items-center gap-3 p-4 transition-colors hover:bg-nova-surface2"
            >
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-nova-border bg-nova-surface2 text-nova-primary">
                <Icon name={ACTION_ICON[e.action] ?? "bell"} className="h-4 w-4" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-white">
                  {e.reminder.title} <span className="text-nova-muted">— {e.action}</span>
                </p>
                {e.detail && <p className="truncate text-xs text-nova-muted">{e.detail}</p>}
              </div>
              <span className="shrink-0 text-xs text-nova-muted">
                {new Date(e.created_at).toLocaleString(undefined, {
                  month: "short",
                  day: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                })}
              </span>
            </Link>
          ))}
          {entries.length === 0 && (
            <div className="p-6 text-center text-sm text-nova-muted">No history yet.</div>
          )}
        </div>
      </section>
    </div>
  );
}
