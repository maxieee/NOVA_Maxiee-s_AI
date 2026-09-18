import { NextResponse } from "next/server";
import { db } from "@/lib/db";

/**
 * Snooze / Remind Again for a payment cycle — delegates entirely to the
 * EXISTING await db.snoozeReminder mechanism on the linked reminder (no new
 * snooze logic). `id` is a payment_cycle id.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const cycle = await db.getPaymentCycle(id);
  if (!cycle) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!cycle.reminder_id) {
    return NextResponse.json({ error: "This cycle has no reminder to snooze yet" }, { status: 400 });
  }

  const body = await req.json().catch(() => ({}));
  const minutes = typeof body?.minutes === "number" ? body.minutes : 15;

  const reminder = await db.snoozeReminder(cycle.reminder_id, minutes);
  return NextResponse.json({ reminder });
}
