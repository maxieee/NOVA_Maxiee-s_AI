import Link from "next/link";
import { PaymentActions } from "@/components/payments/PaymentActions";
import { formatFriendlyDate } from "@/lib/utils/date";
import type { PaymentAccount, PaymentCycle } from "@/types/reminder";

const BUCKET_LABEL: Record<string, string> = {
  overdue: "Overdue",
  due_today: "Due Today",
  due_soon: "Due Soon",
  upcoming: "Upcoming",
  completed: "Paid",
};

const BUCKET_COLOR: Record<string, string> = {
  overdue: "text-nova-urgent",
  due_today: "text-nova-urgent",
  due_soon: "text-nova-warn",
  upcoming: "text-nova-muted",
  completed: "text-nova-good",
};

const BUCKET_DOT: Record<string, string> = {
  overdue: "bg-nova-urgent",
  due_today: "bg-nova-urgent",
  due_soon: "bg-nova-warn",
  upcoming: "bg-nova-muted",
  completed: "bg-nova-good",
};

/**
 * Today-page card for a payment cycle, mirroring ReminderCard's layout so
 * the two item types read as one unified list. Wires the same existing
 * payments API actions as app/payments/page.tsx (via PaymentActions) —
 * no new action path.
 */
export function PaymentTodayCard({
  account,
  cycle,
  bucket,
}: {
  account: PaymentAccount;
  cycle: PaymentCycle;
  bucket: string;
}) {
  const isDone = bucket === "completed";
  return (
    <Link
      href={`/payments/${account.id}`}
      prefetch={false}
      className="nova-card nova-card-hover animate-slide-up flex flex-col gap-3 p-4"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${BUCKET_DOT[bucket]}`} />
            <h3 className={`truncate text-sm font-semibold text-white ${isDone ? "line-through opacity-60" : ""}`}>
              {account.name}
            </h3>
          </div>
          <p className="mt-1 text-xs text-nova-muted">Due {formatFriendlyDate(cycle.due_date)} · ${cycle.amount.toFixed(2)}</p>
        </div>
        <span className="shrink-0 rounded-full border border-nova-accent/30 bg-nova-accent/10 px-2 py-0.5 text-[10px] font-medium text-nova-accent">
          Payment
        </span>
      </div>
      <div className="flex items-center justify-between">
        <span className={`text-xs font-medium ${BUCKET_COLOR[bucket]}`}>{BUCKET_LABEL[bucket]}</span>
        {!isDone && (
          <div onClick={(e) => e.preventDefault()}>
            <PaymentActions cycleId={cycle.id} compact />
          </div>
        )}
      </div>
    </Link>
  );
}
