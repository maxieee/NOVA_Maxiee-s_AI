import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const minutes = typeof body?.minutes === "number" ? body.minutes : 15;

  const reminder = await db.snoozeReminder(id, minutes);
  if (!reminder) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ reminder });
}
