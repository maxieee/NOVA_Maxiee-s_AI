import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const runs = await db.listAutomationRuns(id, 50);
  return NextResponse.json({ runs });
}
