import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import type { PaymentAccountUpdate } from "@/types/reminder";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const account = await db.getPaymentAccount(id);
  if (!account) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const cycles = await db.listPaymentCycles(id);
  return NextResponse.json({ account, cycles });
}

/**
 * Server-side validation: this is a general field editor, never a raw
 * status transition — Mark Paid always goes through the dedicated
 * /paid action endpoint, not `PATCH { status: "paid" }`. There is no
 * `status` field on payment_accounts at all (only payment_cycles has a
 * status, and it's derived/set by the dedicated endpoints).
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const existing = await db.getPaymentAccount(id);
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const allowedKeys: (keyof PaymentAccountUpdate)[] = [
    "name",
    "payment_type",
    "issuer",
    "masked_identifier",
    "statement_date_rule",
    "due_date_rule",
    "fixed_due_day",
    "due_days_after_statement",
    "default_amount",
    "minimum_amount",
    "autopay_enabled",
    "reminder_enabled",
    "escalation_enabled",
    // `active` is editable here too (enable/disable is also exposed via
    // dedicated intent, but a plain PATCH toggling it is harmless — it's
    // not a payment_cycles status transition).
    "active",
  ];
  const update: PaymentAccountUpdate = {};
  for (const key of allowedKeys) {
    if (key in body) (update as Record<string, unknown>)[key] = body[key];
  }

  const account = await db.updatePaymentAccount(id, update);
  return NextResponse.json({ account });
}

/**
 * "Delete" here means disable (active = false): history/cycles are never
 * dropped, matching the append-only reminder_history convention.
 */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const existing = await db.getPaymentAccount(id);
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const account = await db.setPaymentAccountActive(id, false);
  return NextResponse.json({ account });
}
