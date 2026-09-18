import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { checkMemorySafety } from "@/lib/memory/safety";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await req.json()) as {
    category?: string;
    label?: string;
    value?: string;
    active?: boolean;
  };
  if (body.label !== undefined || body.value !== undefined) {
    const safety = checkMemorySafety(body.label ?? "", body.value ?? "");
    if (!safety.ok) {
      return NextResponse.json({ error: safety.reason }, { status: 422 });
    }
  }
  const entry = await db.updatePersonalContext(id, body);
  if (!entry) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ entry });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await db.deletePersonalContext(id);
  return NextResponse.json({ ok: true });
}
