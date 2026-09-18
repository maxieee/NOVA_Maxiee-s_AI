import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { sendPushToUser, isWebPushConfigured } from "@/lib/notifications/providers/webpush";

/**
 * Sends a real test push to every active subscription of the current user.
 * Never reports success unless the underlying web-push call actually
 * succeeded — the response mirrors the real per-subscription outcomes.
 */
export async function POST() {
  const userId = await db.getCurrentUserId();

  if (!isWebPushConfigured()) {
    return NextResponse.json(
      { ok: false, reason: "not_configured", detail: "VAPID keys are not configured on the server." },
      { status: 200 }
    );
  }

  const subscriptions = await db.listActivePushSubscriptions(userId);
  if (subscriptions.length === 0) {
    return NextResponse.json(
      { ok: false, reason: "no_subscription", detail: "No active push subscription found for this browser." },
      { status: 200 }
    );
  }

  const payload = {
    title: "NOVA 🔔",
    body: "This is a test notification from NOVA.",
    data: { url: "/settings", reminderId: null },
    actions: [],
  };

  const results = await sendPushToUser(userId, JSON.stringify(payload));
  const anySent = results.some((r) => r.result.outcome === "sent");

  return NextResponse.json({
    ok: anySent,
    results: results.map((r) => ({ endpoint: r.endpoint, outcome: r.result.outcome, detail: r.result.detail })),
  });
}
