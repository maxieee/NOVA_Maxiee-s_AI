import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { computeNextOccurrence } from "@/lib/scheduling/recurrence";
import { toISODate } from "@/lib/utils/date";
import { onReminderCompleted } from "@/lib/automation/engine";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const existing = await db.getReminder(id);
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const completed = await db.completeReminder(id);

  // V11 Automation Engine: fire any enabled reminder_completed automations
  // at the exact point this event already happens — never a poller.
  if (completed) {
    await onReminderCompleted(completed);
  }

  // Recurring reminders: reschedule a fresh occurrence instead of staying
  // completed forever.
  if (existing.types.includes("recurring") && existing.recurrence) {
    const from = new Date(`${existing.date}T${existing.time ?? "09:00"}:00`);
    const next = computeNextOccurrence(existing.recurrence, from);
    if (next) {
      await db.rescheduleReminder(id, toISODate(next), existing.time);
      await db.updateReminderStatus(id, "scheduled");
      await db.addOccurrence(id, next.toISOString());
      await db.addHistory(id, "updated", `Recurred to next occurrence on ${toISODate(next)}`);
    }
  }

  const reminder = await db.getReminder(id);
  return NextResponse.json({ reminder: reminder ?? completed });
}
