import Link from "next/link";
import { db } from "@/lib/db";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatTile } from "@/components/dashboard/StatTile";
import { Icon } from "@/components/ui/Icon";
import { NewPaymentAccountForm } from "@/components/payments/NewPaymentAccountForm";
import { PaymentActions } from "@/components/payments/PaymentActions";
import { derivePaymentCycleStatus } from "@/lib/scheduling/paymentCycles";
import { formatFriendlyDate } from "@/lib/utils/date";
import type { PaymentCycleStatus } from "@/types/reminder";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<PaymentCycleStatus, string> = {
  overdue: "Overdue",
  due_today: "Due Today",
  due_soon: "Due Soon",
  upcoming: "Upcoming",
  paid: "Paid",
};

const STATUS_CLASS: Record<PaymentCycleStatus, string> = {
  overdue: "text-nova-urgent bg-nova-urgent/10 border-nova-urgent/30",
  due_today: "text-nova-urgent bg-nova-urgent/10 border-nova-urgent/30",
  due_soon: "text-nova-warn bg-nova-warn/10 border-nova-warn/30",
  upcoming: "text-nova-accent bg-nova-accent/10 border-nova-accent/30",
  paid: "text-nova-good bg-nova-good/10 border-nova-good/30",
};

export default async function PaymentsPage() {
  const userId = await db.getCurrentUserId();
  const accounts = await db.listPaymentAccounts(userId);
  const now = new Date();

  // Payment-account model: each account's next (non-paid) cycle, with a
  // freshly-derived display status (payment_cycles.status is also kept in
  // sync by the cron, but rendering never trusts a stale value).
  const rows = await Promise.all(
    accounts
      .filter((a) => a.active)
      .map(async (account) => {
        const cycles = await db.listPaymentCycles(account.id);
        const next = cycles.find((c) => c.status !== "paid") ?? cycles[0] ?? null;
        const status = next ? derivePaymentCycleStatus(next.due_date, now, next.status) : "upcoming";
        return { account, cycle: next, status };
      })
  );

  const overdueCount = rows.filter((r) => r.status === "overdue").length;
  const dueTodayCount = rows.filter((r) => r.status === "due_today").length;
  const dueSoonCount = rows.filter((r) => r.status === "due_soon").length;
  const upcomingCount = rows.filter((r) => r.status === "upcoming").length;

  // Legacy ad-hoc "payment" reminders (created directly, not through a
  // payment account) — kept working exactly as before.
  const adHocPayments = (await db.listReminders(userId, { types: ["payment"] })).filter(
    (r) => !rows.some((row) => row.cycle?.reminder_id === r.id)
  );

  return (
    <div>
      <PageHeader
        title="Payments"
        subtitle="Cards, bills, EMIs & subscriptions in one place"
        action={<NewPaymentAccountForm />}
      />

      <div className="grid grid-cols-2 gap-3 px-4 pt-6 md:grid-cols-4 md:px-8">
        <StatTile label="Overdue" value={overdueCount} icon="alarm-clock" tone="urgent" />
        <StatTile label="Due Today" value={dueTodayCount} icon="clock" tone="urgent" />
        <StatTile label="Due Soon" value={dueSoonCount} icon="calendar" tone="warn" />
        <StatTile label="Upcoming" value={upcomingCount} icon="credit-card" tone="accent" />
      </div>

      <section className="px-4 py-8 md:px-8">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {rows.map(({ account, cycle, status }) => (
            <Link
              key={account.id}
              href={`/payments/${account.id}`}
              prefetch={false}
              className="nova-card nova-card-hover flex flex-col gap-3 p-4"
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold text-white">{account.name}</p>
                  <p className="text-xs text-nova-muted">
                    {account.issuer ?? account.payment_type} {account.masked_identifier ? `· ${account.masked_identifier}` : ""}
                  </p>
                </div>
                <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${STATUS_CLASS[status]}`}>
                  {STATUS_LABEL[status]}
                </span>
              </div>
              {cycle && (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-nova-muted">Due {formatFriendlyDate(cycle.due_date)}</span>
                  <span className="font-semibold text-white">${cycle.amount.toFixed(2)}</span>
                </div>
              )}
              {cycle && status !== "paid" && (
                <div onClick={(e) => e.preventDefault()}>
                  <PaymentActions cycleId={cycle.id} compact />
                </div>
              )}
            </Link>
          ))}
        </div>
        {rows.length === 0 && (
          <div className="nova-card p-6 text-center text-sm text-nova-muted">
            No payment accounts yet. Add one to start tracking cards, bills, EMIs and subscriptions.
          </div>
        )}

        {adHocPayments.length > 0 && (
          <div className="mt-8">
            <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-nova-muted">
              <Icon name="credit-card" className="h-4 w-4" />
              Other payment reminders
            </h2>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {adHocPayments.map((r) => (
                <Link key={r.id} href={`/reminders/${r.id}`} prefetch={false} className="nova-card p-4">
                  <p className="text-sm font-semibold text-white">{r.title}</p>
                  <p className="text-xs text-nova-muted">Due {r.payment?.due_date}</p>
                </Link>
              ))}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
