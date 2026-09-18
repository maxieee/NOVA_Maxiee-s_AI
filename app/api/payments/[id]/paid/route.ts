import { NextResponse } from "next/server";
import { db } from "@/lib/db";

/**
 * Dedicated Mark Paid action — the only way a cycle's status becomes
 * "paid" (never a raw PATCH). `id` is a payment_cycle id. Idempotent:
 * calling this twice on an already-paid cycle is a no-op, not an error.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const cycle = await db.getPaymentCycle(id);
  if (!cycle) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const updated = await db.markPaymentCyclePaid(id);
  return NextResponse.json({ cycle: updated });
}
