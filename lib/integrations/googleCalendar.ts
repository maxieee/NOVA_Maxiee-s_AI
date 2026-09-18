import type { IntegrationConnector, NormalizedEvent, TokenResult } from "./types";

/**
 * Google Calendar connector scaffold — real, standard OAuth2
 * authorization-code-flow URLs and token-exchange logic per Google's
 * actual documented endpoints:
 *   https://developers.google.com/identity/protocols/oauth2/web-server
 *   https://developers.google.com/calendar/api/v3/reference/events/list
 *
 * IMPORTANT (repeated in the V11 report, not just here): this sandbox has
 * no real Google Cloud project, so isConfigured() will honestly return
 * false unless someone supplies real GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET
 * /GOOGLE_REDIRECT_URI. exchangeCode() and fetchEvents() make real fetch()
 * calls to Google's real endpoints when configured, but neither call has
 * been exercised against a live Google account in this environment — that
 * would require a real browser completing the consent screen, which this
 * agent cannot do. No function here ever fabricates a "connected" or
 * "sent" outcome; every failure path is a real, honestly reported one.
 */

const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const CALENDAR_EVENTS_ENDPOINT =
  "https://www.googleapis.com/calendar/v3/calendars/primary/events";

// Read-only scope only — this connector is architected to READ the user's
// calendar for NOVA's own reminder intelligence, never to write to it.
const SCOPE = "https://www.googleapis.com/auth/calendar.readonly";

function credentials() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) return null;
  return { clientId, clientSecret, redirectUri };
}

export const googleCalendarConnector: IntegrationConnector = {
  id: "google_calendar",
  name: "Google Calendar",

  isConfigured(): boolean {
    return credentials() !== null;
  },

  /**
   * Builds a real, well-formed Google OAuth2 consent-screen URL. `state`
   * should be a per-request random/opaque value the caller verifies on
   * callback (CSRF protection) — see app/api/integrations/google/connect.
   */
  getAuthUrl(state: string): string {
    const creds = credentials();
    if (!creds) {
      throw new Error("Google Calendar is not configured — missing GOOGLE_CLIENT_ID/SECRET/REDIRECT_URI.");
    }
    const params = new URLSearchParams({
      client_id: creds.clientId,
      redirect_uri: creds.redirectUri,
      response_type: "code",
      scope: SCOPE,
      access_type: "offline", // request a refresh_token
      prompt: "consent",
      state,
    });
    return `${AUTH_ENDPOINT}?${params.toString()}`;
  },

  /**
   * Real POST to Google's token endpoint per the documented
   * authorization-code exchange. Never claims "connected" unless Google's
   * response actually contains an access_token.
   */
  async exchangeCode(code: string): Promise<TokenResult> {
    const creds = credentials();
    if (!creds) {
      return { outcome: "not_configured", detail: "Google Calendar is not configured." };
    }
    try {
      const body = new URLSearchParams({
        code,
        client_id: creds.clientId,
        client_secret: creds.clientSecret,
        redirect_uri: creds.redirectUri,
        grant_type: "authorization_code",
      });
      const res = await fetch(TOKEN_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        return { outcome: "failed", detail: `Google token exchange failed (${res.status}): ${text}` };
      }
      const json = (await res.json().catch(() => null)) as
        | { access_token?: string; refresh_token?: string; expires_in?: number }
        | null;
      if (!json?.access_token) {
        return { outcome: "failed", detail: "Google token exchange returned no access_token." };
      }
      const expiresAt = json.expires_in
        ? new Date(Date.now() + json.expires_in * 1000).toISOString()
        : undefined;
      return {
        outcome: "connected",
        accessToken: json.access_token,
        refreshToken: json.refresh_token,
        expiresAt,
        detail: "Token exchange succeeded.",
      };
    } catch (err) {
      return {
        outcome: "failed",
        detail: `Google token exchange errored: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  },

  /** Real read-only Calendar API v3 events.list call. Never fabricates events. */
  async fetchEvents(accessToken: string): Promise<NormalizedEvent[]> {
    const params = new URLSearchParams({
      singleEvents: "true",
      orderBy: "startTime",
      timeMin: new Date().toISOString(),
      maxResults: "20",
    });
    const res = await fetch(`${CALENDAR_EVENTS_ENDPOINT}?${params.toString()}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) {
      throw new Error(`Google Calendar events.list failed (${res.status})`);
    }
    const json = (await res.json()) as {
      items?: Array<{ id: string; summary?: string; start?: { dateTime?: string; date?: string }; end?: { dateTime?: string; date?: string } }>;
    };
    return (json.items ?? []).map((item) => ({
      id: item.id,
      title: item.summary ?? "(untitled event)",
      start: item.start?.dateTime ?? item.start?.date ?? "",
      end: item.end?.dateTime ?? item.end?.date ?? null,
      source: "google_calendar" as const,
    }));
  },
};

export function isGoogleCalendarConfigured(): boolean {
  return googleCalendarConnector.isConfigured();
}
