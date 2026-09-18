import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getNotificationProvider, isTwilioConfigured } from "@/lib/notifications/providers";
import { validatePhoneNumber } from "@/lib/notifications/validatePhoneNumber";

/**
 * Places a real test call via Twilio. Requires the caller to have already
 * gone through the Settings UI's explicit confirmation step — this route
 * itself also requires `confirm: true` in the body as a second guard, so a
 * stray/automated POST can never trigger a real call.
 *
 * Never fires on its own: no GET handler, no default body, no optimistic
 * success — the true provider outcome is always returned.
 */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { confirm?: boolean; phoneNumber?: string };

  if (body.confirm !== true) {
    return NextResponse.json(
      { ok: false, reason: "not_confirmed", detail: "Test call requires explicit confirmation." },
      { status: 400 }
    );
  }

  if (!isTwilioConfigured()) {
    return NextResponse.json(
      { ok: false, reason: "not_configured", detail: "Phone calling is not configured yet." },
      { status: 200 }
    );
  }

  const userId = await db.getCurrentUserId();
  const preferences = await db.getPreferences(userId);
  const phoneNumber = body.phoneNumber ?? preferences.phone_number;

  const check = validatePhoneNumber(phoneNumber);
  if (!check.valid) {
    return NextResponse.json(
      { ok: false, reason: "invalid_number", detail: check.reason },
      { status: 200 }
    );
  }

  const provider = getNotificationProvider();
  const result = await provider.placeCall(
    phoneNumber as string,
    "Hello. This is a test call from NOVA to confirm phone-call escalation is working correctly."
  );

  return NextResponse.json({
    ok: result.outcome === "sent",
    reason: result.outcome,
    detail: result.detail,
  });
}
