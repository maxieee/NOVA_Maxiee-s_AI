import { NextRequest, NextResponse } from "next/server";
import { scanAndProcessDueReminders } from "@/lib/scheduling/dueScan";

/**
 * Server-side "source of truth" cron endpoint. Meant to be invoked by a
 * real scheduler (Vercel Cron in production, curl/npm script locally) —
 * there is no client-side setTimeout driving this. Protected by a shared
 * secret so it can't be triggered by anyone who finds the URL.
 */
export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    // Vercel Cron sends `Authorization: Bearer <CRON_SECRET>`; local/manual
    // invocations (curl, npm run dev:cron) use the simpler x-cron-secret header.
    const authHeader = req.headers.get("authorization");
    const provided = req.headers.get("x-cron-secret") ?? authHeader?.replace(/^Bearer\s+/i, "");
    if (provided !== secret) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const results = await scanAndProcessDueReminders();
  return NextResponse.json({ processed: results.length, results });
}
