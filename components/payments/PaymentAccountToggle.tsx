"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";

export function PaymentAccountToggle({ accountId, active }: { accountId: string; active: boolean }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  async function toggle() {
    if (active) {
      await fetch(`/api/payments/${accountId}`, { method: "DELETE" });
    } else {
      await fetch(`/api/payments/${accountId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: true }),
      });
    }
    startTransition(() => router.refresh());
  }

  return (
    <button onClick={toggle} disabled={isPending} className="nova-btn-secondary w-full justify-center">
      {active ? "Disable account" : "Enable account"}
    </button>
  );
}
