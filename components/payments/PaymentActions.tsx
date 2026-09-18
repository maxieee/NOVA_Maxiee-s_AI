"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/ui/Icon";

export function PaymentActions({
  cycleId,
  compact,
  disabled,
}: {
  cycleId: string;
  compact?: boolean;
  disabled?: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function stop(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
  }

  async function markPaid(e: React.MouseEvent) {
    stop(e);
    await fetch(`/api/payments/${cycleId}/paid`, { method: "POST" });
    startTransition(() => router.refresh());
  }

  async function remindAgain(e: React.MouseEvent) {
    stop(e);
    await fetch(`/api/payments/${cycleId}/snooze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ minutes: 60 }),
    });
    startTransition(() => router.refresh());
  }

  return (
    <div className="flex items-center gap-2" onClick={stop}>
      <button
        onClick={markPaid}
        disabled={isPending || disabled}
        className={`nova-btn-primary ${compact ? "px-3 py-1.5 text-xs" : ""}`}
      >
        <Icon name="check" className="h-3.5 w-3.5" />
        Mark Paid
      </button>
      <button
        onClick={remindAgain}
        disabled={isPending || disabled}
        className={`nova-btn-secondary ${compact ? "px-3 py-1.5 text-xs" : ""}`}
      >
        <Icon name="refresh-cw" className="h-3.5 w-3.5" />
        Remind Again
      </button>
    </div>
  );
}
