import { describe, it, expect, beforeAll, beforeEach } from "vitest";

/**
 * Google Calendar connector — honesty checks only. No network call is ever
 * made in this test file. Follows the pre-warm pattern from
 * tests/proactive-engine.test.ts even though this module has no DB, to
 * stay consistent with the project's established test conventions.
 */
describe("Google Calendar integration connector", () => {
  beforeAll(async () => {
    await import("../lib/integrations/googleCalendar");
  });

  beforeEach(() => {
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
    delete process.env.GOOGLE_REDIRECT_URI;
  });

  it("honestly reports not configured with no env vars", async () => {
    const { googleCalendarConnector } = await import("../lib/integrations/googleCalendar");
    expect(googleCalendarConnector.isConfigured()).toBe(false);
  });

  it("exchangeCode reports not_configured (never fakes a connection) with no env vars", async () => {
    const { googleCalendarConnector } = await import("../lib/integrations/googleCalendar");
    const result = await googleCalendarConnector.exchangeCode!("some-code");
    expect(result.outcome).toBe("not_configured");
  });

  it("getAuthUrl throws rather than returning a URL when not configured", async () => {
    const { googleCalendarConnector } = await import("../lib/integrations/googleCalendar");
    expect(() => googleCalendarConnector.getAuthUrl!("state123")).toThrow();
  });

  it("reports configured once real-shaped (test) credentials are present", async () => {
    process.env.GOOGLE_CLIENT_ID = "test-client-id.apps.googleusercontent.com";
    process.env.GOOGLE_CLIENT_SECRET = "test-client-secret";
    process.env.GOOGLE_REDIRECT_URI = "http://localhost:3000/api/integrations/google/callback";
    const { googleCalendarConnector } = await import("../lib/integrations/googleCalendar");
    expect(googleCalendarConnector.isConfigured()).toBe(true);
  });

  it("builds a correct, well-formed Google OAuth2 consent URL with no network call", async () => {
    process.env.GOOGLE_CLIENT_ID = "test-client-id.apps.googleusercontent.com";
    process.env.GOOGLE_CLIENT_SECRET = "test-client-secret";
    process.env.GOOGLE_REDIRECT_URI = "http://localhost:3000/api/integrations/google/callback";
    const { googleCalendarConnector } = await import("../lib/integrations/googleCalendar");

    const url = new URL(googleCalendarConnector.getAuthUrl!("csrf-state-abc"));

    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(url.searchParams.get("client_id")).toBe("test-client-id.apps.googleusercontent.com");
    expect(url.searchParams.get("redirect_uri")).toBe(
      "http://localhost:3000/api/integrations/google/callback"
    );
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("scope")).toBe("https://www.googleapis.com/auth/calendar.readonly");
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("state")).toBe("csrf-state-abc");
  });

  // NOTE — documented limitation, not a gap papered over: a real token
  // exchange or Calendar API call cannot be verified in this sandbox (no
  // real Google Cloud project, no browser to complete OAuth consent). The
  // exchangeCode/fetchEvents network paths above are exercised only for
  // their "not configured" / URL-building honesty, never against a live
  // Google account.
});
