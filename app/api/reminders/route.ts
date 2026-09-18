import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import type { ReminderInput } from "@/types/reminder";

export async function GET() {
  const userId = await db.getCurrentUserId();
  const reminders = await db.listReminders(userId);
  return NextResponse.json({ reminders });
}

export async function POST(req: NextRequest) {
  const userId = await db.getCurrentUserId();
  const input = (await req.json()) as ReminderInput;

  if (!input.title || !input.date || !input.types?.length) {
    return NextResponse.json(
      { error: "title, date and at least one type are required" },
      { status: 400 }
    );
  }

  const reminder = await db.createReminder(userId, input);
  return NextResponse.json({ reminder }, { status: 201 });
}
