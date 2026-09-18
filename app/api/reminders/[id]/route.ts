import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const reminder = db.getReminder(id);
  if (!reminder) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const history = db.listHistory(id);
  const occurrences = db.listOccurrences(id);
  return NextResponse.json({ reminder, history, occurrences });
}
