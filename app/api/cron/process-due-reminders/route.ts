import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { compareSecret } from "@/lib/auth/compareSecret";
import { scanAndProcessDueReminders } from "@/lib/scheduling/dueScan";
import { generateMissingCycles, refreshCycleStatuses } from "@/lib/scheduling/paymentCycles";
import { generateMissingReminders } from "@/lib/scheduling/paymentReminders";
import { runProactiveIntelligence } from "@/lib/proactive/engine";
import { runPeriodicAutomations, runPaymentOverdueAutomations } from "@/lib/automation/engine";

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
    //
    // This route is exempt from the app-wide middleware.ts auth gate (see
    // its comment) and guards itself here with CRON_SECRET specifically.
    // APP_ACCESS_TOKEN is a *different* secret for a *different* trust
    // boundary (the app's one human user vs. Vercel's cron scheduler) and
    // must never be accepted as a substitute here — this check only ever
    // compares against process.env.CRON_SECRET, never APP_ACCESS_TOKEN.
    const authHeader = req.headers.get("authorization");
    const provided = req.headers.get("x-cron-secret") ?? authHeader?.replace(/^Bearer\s+/i, "") ?? null;
    if (!compareSecret(provided, secret)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  // Payment Intelligence (V5): before/alongside the existing due-reminder
  // scan — generate any missing cycles/reminders and refresh derived
  // statuses, all idempotent (see lib/scheduling/paymentCycles.ts and
  // paymentReminders.ts), then continue into the unchanged existing scan.
  const userId = await db.getCurrentUserId();
  const preferences = await db.getPreferences(userId);
  await generateMissingCycles(userId);
  await generateMissingReminders(userId, preferences.preferred_channels, preferences.default_intensity);
  await refreshCycleStatuses(userId);

  const results = await scanAndProcessDueReminders();

  // Proactive Intelligence (V8): runs in this SAME cron invocation, after
  // the existing due-reminder scan — not a second scheduler. Purely
  // additive/observational: it never mutates reminder/occurrence state,
  // only reads it and (subject to quiet hours + its own per-rule cooldown)
  // sends alerts through the same honest provider abstraction.
  const proactive = await runProactiveIntelligence();

  // V11 Automation Engine (time-based + payment_overdue triggers): same
  // cron invocation, not a second scheduler. Event-based triggers
  // (reminder_completed) fire synchronously at their own call sites
  // instead — see lib/automation/engine.ts.
  const periodicAutomations = await runPeriodicAutomations();
  const paymentOverdueAutomations = await runPaymentOverdueAutomations();

  return NextResponse.json({
    processed: results.length,
    results,
    proactive,
    automations: { periodic: periodicAutomations, paymentOverdue: paymentOverdueAutomations },
  });
}
