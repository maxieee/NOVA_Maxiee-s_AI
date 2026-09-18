import { db } from "@/lib/db";
import { PageHeader } from "@/components/ui/PageHeader";
import { ReminderCard } from "@/components/reminders/ReminderCard";

export const dynamic = "force-dynamic";

export default function TasksPage() {
  const userId = db.getCurrentUserId();
  const tasks = db.listReminders(userId, { types: ["task"] });
  const open = tasks.filter((t) => t.status !== "completed" && t.status !== "cancelled");
  const done = tasks.filter((t) => t.status === "completed" || t.status === "cancelled");

  return (
    <div>
      <PageHeader title="Tasks" subtitle="Everything you need to do, tracked to completion" />

      <section className="px-4 pt-6 md:px-8">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {open.map((r) => (
            <ReminderCard key={r.id} reminder={r} />
          ))}
        </div>
        {open.length === 0 && (
          <div className="nova-card p-6 text-center text-sm text-nova-muted">
            No open tasks. Create one with the Task type.
          </div>
        )}
      </section>

      {done.length > 0 && (
        <section className="px-4 py-8 md:px-8">
          <h2 className="mb-3 text-lg font-semibold text-white">Completed</h2>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {done.map((r) => (
              <ReminderCard key={r.id} reminder={r} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
