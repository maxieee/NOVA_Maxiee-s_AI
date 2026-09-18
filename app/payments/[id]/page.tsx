import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { PageHeader } from "@/components/ui/PageHeader";
import { PaymentActions } from "@/components/payments/PaymentActions";
import { PaymentAccountToggle } from "@/components/payments/PaymentAccountToggle";
import { derivePaymentCycleStatus } from "@/lib/scheduling/paymentCycles";
import { formatFriendlyDate } from "@/lib/utils/date";

export const dynamic = "force-dynamic";

export default async function PaymentAccountDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const account = await db.getPaymentAccount(id);
  if (!account) notFound();

  const now = new Date();
  const cycles = (await db.listPaymentCycles(id)).map((c) => ({ ...c, status: derivePaymentCycleStatus(c.due_date, now, c.status) }));
  const nextCycle = cycles.find((c) => c.status !== "paid") ?? null;
  const history = cycles.filter((c) => c.status === "paid" || c !== nextCycle);

  return (
    <div>
      <PageHeader title={account.name} subtitle={`${account.payment_type.replace("_", " ")}${account.issuer ? ` · ${account.issuer}` : ""}`} />

      <section className="grid gap-4 px-4 py-6 md:grid-cols-3 md:px-8">
        <div className="nova-card space-y-2 p-5 md:col-span-2">
          <h2 className="text-sm font-semibold text-white">Next due</h2>
          {nextCycle ? (
            <>
              <p className="text-2xl font-semibold text-white">${nextCycle.amount.toFixed(2)}</p>
              <p className="text-sm text-nova-muted">
                Due {formatFriendlyDate(nextCycle.due_date)} · statement {formatFriendlyDate(nextCycle.statement_date)}
              </p>
              <div className="pt-2">
                <PaymentActions cycleId={nextCycle.id} disabled={!account.active} />
              </div>
            </>
          ) : (
            <p className="text-sm text-nova-muted">No upcoming cycle yet — the next cron run will generate one.</p>
          )}
        </div>

        <div className="nova-card space-y-3 p-5">
          <h2 className="text-sm font-semibold text-white">Account</h2>
          <dl className="space-y-1.5 text-sm">
            <div className="flex justify-between">
              <dt className="text-nova-muted">Identifier</dt>
              <dd className="text-white">{account.masked_identifier ?? "—"}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-nova-muted">Autopay</dt>
              <dd className="text-white">{account.autopay_enabled ? "On" : "Off"}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-nova-muted">Reminders</dt>
              <dd className="text-white">{account.reminder_enabled ? "On" : "Off"}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-nova-muted">Escalation</dt>
              <dd className="text-white">{account.escalation_enabled ? "On" : "Off"}</dd>
            </div>
          </dl>
          <PaymentAccountToggle accountId={account.id} active={account.active} />
        </div>
      </section>

      <section className="px-4 pb-10 md:px-8">
        <h2 className="mb-3 text-sm font-semibold text-nova-muted">History</h2>
        <div className="nova-card divide-y divide-nova-border">
          {history.length === 0 && <p className="p-4 text-sm text-nova-muted">No past cycles yet.</p>}
          {history.map((c) => (
            <div key={c.id} className="flex items-center justify-between p-4 text-sm">
              <div>
                <p className="text-white">{c.cycle_period}</p>
                <p className="text-xs text-nova-muted">
                  Statement {formatFriendlyDate(c.statement_date)} · Due {formatFriendlyDate(c.due_date)}
                </p>
              </div>
              <div className="text-right">
                <p className="font-medium text-white">${c.amount.toFixed(2)}</p>
                <p className="text-xs text-nova-muted">
                  {c.status === "paid" ? `Paid ${c.paid_at ? formatFriendlyDate(c.paid_at.slice(0, 10)) : ""}` : c.status}
                </p>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
