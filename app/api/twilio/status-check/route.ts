import { NextResponse } from "next/server";
import { isTwilioConfigured } from "@/lib/notifications/providers";

/**
 * Reports only a boolean — never the credential values themselves — so the
 * Settings UI can show a real "Configured"/"Not configured" status without
 * ever exposing TWILIO_ACCOUNT_SID/AUTH_TOKEN/PHONE_NUMBER to the client.
 */
export async function GET() {
  return NextResponse.json({ configured: isTwilioConfigured() });
}
