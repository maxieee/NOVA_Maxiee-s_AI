import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import type { UserPreferencesUpdate } from "@/types/reminder";

export async function GET() {
  const userId = db.getCurrentUserId();
  const preferences = db.getPreferences(userId);
  return NextResponse.json({ preferences });
}

export async function PATCH(req: NextRequest) {
  const userId = db.getCurrentUserId();
  const update = (await req.json()) as UserPreferencesUpdate;
  const preferences = db.updatePreferences(userId, update);
  return NextResponse.json({ preferences });
}
