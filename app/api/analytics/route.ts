import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { buildAnalyticsReport } from "@/lib/analytics/report";

export async function GET() {
  const userId = await db.getCurrentUserId();
  const report = buildAnalyticsReport(userId);
  return NextResponse.json(report);
}
