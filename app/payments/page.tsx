import { db } from "@/lib/db";
import { PageHeader } from "@/components/ui/PageHeader";
import { ReminderCard } from "@/components/reminders/ReminderCard";
import { StatTile } from "@/components/dashboard/StatTile";

export const dynamic = "force-dynamic";

export default function PaymentsPage() {
  const userId = db.getCurrentUserId();
  const payments = db.listReminders(userId, { types: ["payment"] });

  const totalDue = payments
    .filter((p) => p.status !== "completed" && p.payment)
    .reduce((sum, p) => sum + (p.payment?.amount ?? 0), 0);
  const overdueCount = payments.filter((p) => p.payment?.paid_status === "overdue").length;
  const autopayCount = payments.filter((p) => p.payment?.autopay).length;
  const paidCount = payments.filter((p) => p.payment?.paid_status === "paid").length;

  return (
    <div>
      <PageHeader title="Payments" subtitle="Cards, bills, EMIs & subscriptions in one place" />

      <div className="grid grid-cols-2 gap-3 px-4 pt-6 md:grid-cols-4 md:px-8">
        <StatTile label="Total Due" value={Math.round(totalDue)} icon="credit-card" tone="accent" />
        <StatTile label="Overdue" value={overdueCount} icon="alarm-clock" tone="urgent" />
        <StatTile label="Autopay" value={autopayCount} icon="refresh-cw" tone="good" />
        <StatTile label="Paid" value={paidCount} icon="check" tone="good" />
      </div>

      <section className="px-4 py-8 md:px-8">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {payments.map((r) => (
            <ReminderCard key={r.id} reminder={r} />
          ))}
        </div>
        {payments.length === 0 && (
          <div className="nova-card p-6 text-center text-sm text-nova-muted">
            No payments tracked yet. Create a reminder with the Payment type.
          </div>
        )}
      </section>
    </div>
  );
}
