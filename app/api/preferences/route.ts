import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import type { UserPreferencesUpdate } from "@/types/reminder";

export async function GET() {
  const userId = await db.getCurrentUserId();
  const preferences = await db.getPreferences(userId);
  return NextResponse.json({ preferences });
}

export async function PATCH(req: NextRequest) {
  const userId = await db.getCurrentUserId();
  const update = (await req.json()) as UserPreferencesUpdate;
  const preferences = await db.updatePreferences(userId, update);
  return NextResponse.json({ preferences });
}
