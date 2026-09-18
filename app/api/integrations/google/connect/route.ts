import { NextResponse } from "next/server";
import { googleCalendarConnector } from "@/lib/integrations/googleCalendar";
import { newId } from "@/lib/utils/id";

/**
 * Starts the real Google OAuth2 authorization-code flow by redirecting to
 * Google's actual consent screen. Honestly refuses (400, no redirect) when
 * GOOGLE_CLIENT_ID/SECRET/REDIRECT_URI are not set — this route has never
 * been exercised against a real Google account in this environment (no
 * browser here to complete consent), but the redirect URL it builds is
 * real and well-formed per Google's documented OAuth2 endpoints.
 */
export async function GET() {
  if (!googleCalendarConnector.isConfigured()) {
    return NextResponse.json(
      { error: "Google Calendar is not configured. Set GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET/GOOGLE_REDIRECT_URI." },
      { status: 400 }
    );
  }
  const state = newId();
  const authUrl = googleCalendarConnector.getAuthUrl!(state);
  const res = NextResponse.redirect(authUrl);
  // Minimal CSRF protection for the callback (matches the pattern of a
  // short-lived signed cookie; full session infra is out of scope for a
  // single-user app).
  res.cookies.set("nova_google_oauth_state", state, { httpOnly: true, maxAge: 600, path: "/" });
  return res;
}
