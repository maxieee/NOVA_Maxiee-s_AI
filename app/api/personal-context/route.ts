import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { checkMemorySafety } from "@/lib/memory/safety";

export async function GET(req: NextRequest) {
  const userId = await db.getCurrentUserId();
  const includeInactive = req.nextUrl.searchParams.get("includeInactive") === "1";
  const entries = await db.listPersonalContext(userId, { includeInactive });
  return NextResponse.json({ entries });
}

export async function POST(req: NextRequest) {
  const userId = await db.getCurrentUserId();
  const body = (await req.json()) as { category?: string; label?: string; value?: string };
  if (!body.label?.trim() || !body.value?.trim()) {
    return NextResponse.json({ error: "label and value are required" }, { status: 400 });
  }
  const safety = checkMemorySafety(body.label, body.value);
  if (!safety.ok) {
    return NextResponse.json({ error: safety.reason }, { status: 422 });
  }
  const entry = await db.addPersonalContext(userId, {
    category: body.category,
    label: body.label,
    value: body.value,
    source: "user_entered",
  });
  return NextResponse.json({ entry }, { status: 201 });
}
