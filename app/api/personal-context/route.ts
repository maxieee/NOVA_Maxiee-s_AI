import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function GET() {
  const userId = db.getCurrentUserId();
  const entries = db.listPersonalContext(userId);
  return NextResponse.json({ entries });
}

export async function POST(req: NextRequest) {
  const userId = db.getCurrentUserId();
  const body = (await req.json()) as { category?: string; label?: string; value?: string };
  if (!body.label?.trim() || !body.value?.trim()) {
    return NextResponse.json({ error: "label and value are required" }, { status: 400 });
  }
  const entry = db.addPersonalContext(userId, {
    category: body.category,
    label: body.label,
    value: body.value,
  });
  return NextResponse.json({ entry }, { status: 201 });
}
