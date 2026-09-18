import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { scanAndProcessDueReminders } from "@/lib/scheduling/dueScan";
import { generateMissingCycles, refreshCycleStatuses } from "@/lib/scheduling/paymentCycles";
import { generateMissingReminders } from "@/lib/scheduling/paymentReminders";
import { runProactiveIntelligence } from "@/lib/proactive/engine";

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

  // Payment Intelligence (V5): before/alongside the existing due-reminder
  // scan — generate any missing cycles/reminders and refresh derived
  // statuses, all idempotent (see lib/scheduling/paymentCycles.ts and
  // paymentReminders.ts), then continue into the unchanged existing scan.
  const userId = db.getCurrentUserId();
  const preferences = db.getPreferences(userId);
  generateMissingCycles(userId);
  generateMissingReminders(userId, preferences.preferred_channels, preferences.default_intensity);
  refreshCycleStatuses(userId);

  const results = await scanAndProcessDueReminders();

  // Proactive Intelligence (V8): runs in this SAME cron invocation, after
  // the existing due-reminder scan — not a second scheduler. Purely
  // additive/observational: it never mutates reminder/occurrence state,
  // only reads it and (subject to quiet hours + its own per-rule cooldown)
  // sends alerts through the same honest provider abstraction.
  const proactive = await runProactiveIntelligence();

  return NextResponse.json({ processed: results.length, results, proactive });
}
