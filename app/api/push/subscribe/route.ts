import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { validateSubscriptionPayload } from "@/lib/notifications/validateSubscription";

interface SubscribeBody {
  endpoint?: unknown;
  keys?: { p256dh?: unknown; auth?: unknown };
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as SubscribeBody | null;
  const error = validateSubscriptionPayload(body ?? {});
  if (error) {
    return NextResponse.json({ error }, { status: 400 });
  }

  const userId = db.getCurrentUserId();
  const subscription = db.upsertPushSubscription(userId, {
    endpoint: body!.endpoint as string,
    p256dh: body!.keys!.p256dh as string,
    auth: body!.keys!.auth as string,
  });

  return NextResponse.json({ subscribed: true, id: subscription.id });
}
