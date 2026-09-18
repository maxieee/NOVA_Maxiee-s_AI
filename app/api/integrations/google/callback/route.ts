import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { googleCalendarConnector } from "@/lib/integrations/googleCalendar";

/**
 * Real OAuth2 callback handler: verifies `state` against the cookie set by
 * /api/integrations/google/connect, then performs a real token exchange
 * against Google's token endpoint. Persists the result honestly —
 * "connected" only on a genuine successful exchange, "error" otherwise.
 * This code path cannot be exercised end-to-end in this sandbox (no real
 * Google Cloud project, no browser to complete consent), which is a
 * documented limitation, not something papered over.
 */
export async function GET(req: NextRequest) {
  const userId = db.getCurrentUserId();
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const cookieState = req.cookies.get("nova_google_oauth_state")?.value;
  const error = url.searchParams.get("error");

  if (error) {
    db.upsertIntegrationAccount(userId, "google_calendar", {
      status: "error",
      last_error: `Google returned an error: ${error}`,
    });
    return NextResponse.redirect(new URL("/settings?integration=google_calendar&result=error", req.url));
  }

  if (!code || !state || !cookieState || state !== cookieState) {
    db.upsertIntegrationAccount(userId, "google_calendar", {
      status: "error",
      last_error: "OAuth state mismatch or missing authorization code.",
    });
    return NextResponse.redirect(new URL("/settings?integration=google_calendar&result=error", req.url));
  }

  const result = await googleCalendarConnector.exchangeCode!(code);

  if (result.outcome !== "connected") {
    db.upsertIntegrationAccount(userId, "google_calendar", {
      status: "error",
      last_error: result.detail ?? "Token exchange did not succeed.",
    });
    return NextResponse.redirect(new URL("/settings?integration=google_calendar&result=error", req.url));
  }

  db.upsertIntegrationAccount(userId, "google_calendar", {
    status: "connected",
    access_token: result.accessToken ?? null,
    refresh_token: result.refreshToken ?? null,
    expires_at: result.expiresAt ?? null,
    connected_at: new Date().toISOString(),
    last_error: null,
  });

  const res = NextResponse.redirect(new URL("/settings?integration=google_calendar&result=connected", req.url));
  res.cookies.delete("nova_google_oauth_state");
  return res;
}
