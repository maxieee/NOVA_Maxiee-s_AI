"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/ui/Icon";

const inputClass =
  "w-full rounded-xl border border-nova-border bg-nova-surface2 px-3 py-2 text-sm text-white outline-none transition-colors focus:border-nova-accent";

export function NewPaymentAccountForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [paymentType, setPaymentType] = useState("CREDIT_CARD");
  const [dueDateRule, setDueDateRule] = useState<"fixed_day" | "days_after_statement">("fixed_day");
  const [statementDay, setStatementDay] = useState(1);
  const [dueDay, setDueDay] = useState(20);
  const [daysAfter, setDaysAfter] = useState(20);
  const [amount, setAmount] = useState(0);
  const [masked, setMasked] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    await fetch("/api/payments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        payment_type: paymentType,
        masked_identifier: masked || null,
        active: true,
        statement_date_rule: statementDay,
        due_date_rule: dueDateRule,
        fixed_due_day: dueDateRule === "fixed_day" ? dueDay : null,
        due_days_after_statement: dueDateRule === "days_after_statement" ? daysAfter : null,
        default_amount: amount,
        autopay_enabled: false,
        reminder_enabled: true,
        escalation_enabled: true,
      }),
    });
    setOpen(false);
    setName("");
    startTransition(() => router.refresh());
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="nova-btn-primary">
        <Icon name="plus" className="h-3.5 w-3.5" />
        Add Payment
      </button>
    );
  }

  return (
    <form
      onSubmit={submit}
      className="nova-card w-full max-w-md space-y-3 p-4 md:absolute md:right-8 md:top-20 md:z-20"
    >
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-white">New payment account</h3>
        <button type="button" onClick={() => setOpen(false)} className="text-nova-muted hover:text-white">
          <Icon name="x" className="h-4 w-4" />
        </button>
      </div>
      <input
        className={inputClass}
        placeholder="Name (e.g. Visa Platinum)"
        value={name}
        onChange={(e) => setName(e.target.value)}
        required
      />
      <input
        className={inputClass}
        placeholder="Masked identifier (e.g. Visa •••• 1234) — optional"
        value={masked}
        onChange={(e) => setMasked(e.target.value)}
      />
      <select className={inputClass} value={paymentType} onChange={(e) => setPaymentType(e.target.value)}>
        <option value="CREDIT_CARD">Credit Card</option>
        <option value="EMI">EMI</option>
        <option value="BILL">Bill</option>
        <option value="SUBSCRIPTION">Subscription</option>
        <option value="OTHER">Other</option>
      </select>
      <div className="flex gap-2">
        <label className="flex-1 text-xs text-nova-muted">
          Statement day
          <input
            type="number"
            min={1}
            max={31}
            className={`${inputClass} mt-1`}
            value={statementDay}
            onChange={(e) => setStatementDay(Number(e.target.value))}
          />
        </label>
        <label className="flex-1 text-xs text-nova-muted">
          Default amount
          <input
            type="number"
            min={0}
            step="0.01"
            className={`${inputClass} mt-1`}
            value={amount}
            onChange={(e) => setAmount(Number(e.target.value))}
          />
        </label>
      </div>
      <select
        className={inputClass}
        value={dueDateRule}
        onChange={(e) => setDueDateRule(e.target.value as "fixed_day" | "days_after_statement")}
      >
        <option value="fixed_day">Due on fixed day of month</option>
        <option value="days_after_statement">Due N days after statement</option>
      </select>
      {dueDateRule === "fixed_day" ? (
        <label className="block text-xs text-nova-muted">
          Due day
          <input
            type="number"
            min={1}
            max={31}
            className={`${inputClass} mt-1`}
            value={dueDay}
            onChange={(e) => setDueDay(Number(e.target.value))}
          />
        </label>
      ) : (
        <label className="block text-xs text-nova-muted">
          Days after statement
          <input
            type="number"
            min={0}
            max={60}
            className={`${inputClass} mt-1`}
            value={daysAfter}
            onChange={(e) => setDaysAfter(Number(e.target.value))}
          />
        </label>
      )}
      <button type="submit" disabled={isPending} className="nova-btn-primary w-full justify-center">
        Create
      </button>
    </form>
  );
}
