import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const endpoint = body?.endpoint;
  if (typeof endpoint !== "string" || !endpoint) {
    return NextResponse.json({ error: "Missing endpoint." }, { status: 400 });
  }
  db.deactivatePushSubscription(endpoint);
  return NextResponse.json({ unsubscribed: true });
}
