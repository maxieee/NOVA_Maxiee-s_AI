import { db } from "@/lib/db";
import { PageHeader } from "@/components/ui/PageHeader";
import { ReminderCard } from "@/components/reminders/ReminderCard";
import { TypeFilterBar } from "@/components/reminders/TypeFilterBar";
import Link from "next/link";
import { Icon } from "@/components/ui/Icon";
import type { ReminderTypeKey } from "@/types/reminder";

export const dynamic = "force-dynamic";

export default async function RemindersPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string }>;
}) {
  const { type } = await searchParams;
  const userId = await db.getCurrentUserId();
  const reminders = await db.listReminders(userId, {
    types: type ? [type as ReminderTypeKey] : undefined,
  });

  const active = reminders.filter((r) => r.status !== "completed" && r.status !== "cancelled");
  const done = reminders.filter((r) => r.status === "completed" || r.status === "cancelled");

  return (
    <div>
      <PageHeader
        title="Reminders"
        subtitle="Everything you've asked NOVA to keep track of"
        action={
          <Link href="/reminders/new" className="nova-btn-primary hidden md:inline-flex">
            <Icon name="plus" className="h-4 w-4" />
            Create Reminder
          </Link>
        }
      />

      <div className="px-4 pt-6 md:px-8">
        <TypeFilterBar basePath="/reminders" />
      </div>

      <section className="px-4 pt-6 md:px-8">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {active.map((r) => (
            <ReminderCard key={r.id} reminder={r} />
          ))}
        </div>
        {active.length === 0 && (
          <div className="nova-card p-6 text-center text-sm text-nova-muted">
            No matching reminders. Try a different filter or create one.
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
