import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";

const APP_TOKEN = "test-app-token-abc123";
const CRON_TOKEN = "test-cron-secret-xyz789";

function makeRequest(url: string, init?: { headers?: Record<string, string>; method?: string }) {
  return new NextRequest(new URL(url, "http://localhost:3000"), {
    method: init?.method ?? "GET",
    headers: init?.headers,
  });
}

describe("auth middleware", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.APP_ACCESS_TOKEN = APP_TOKEN;
    process.env.CRON_SECRET = CRON_TOKEN;
    vi.resetModules();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  async function importMiddleware() {
    return await import("../middleware");
  }

  it("1. rejects a request with no token", async () => {
    const { isAuthorizedRequest } = await importMiddleware();
    expect(isAuthorizedRequest(makeRequest("/api/reminders"))).toBe(false);
  });

  it("2. rejects a request with an invalid token", async () => {
    const { isAuthorizedRequest } = await importMiddleware();
    const req = makeRequest("/api/reminders", { headers: { authorization: "Bearer wrong-token" } });
    expect(isAuthorizedRequest(req)).toBe(false);
  });

  it("3. accepts a request with the correct bearer token", async () => {
    const { isAuthorizedRequest } = await importMiddleware();
    const req = makeRequest("/api/reminders", { headers: { authorization: `Bearer ${APP_TOKEN}` } });
    expect(isAuthorizedRequest(req)).toBe(true);
  });

  it("3b. accepts a request with a valid session cookie", async () => {
    const { isAuthorizedRequest } = await importMiddleware();
    const req = makeRequest("/api/reminders", { headers: { cookie: "nova_session=authenticated" } });
    expect(isAuthorizedRequest(req)).toBe(true);
  });

  it("full middleware() returns 401 JSON for an unauthenticated protected route", async () => {
    const { middleware } = await importMiddleware();
    const res = middleware(makeRequest("/api/reminders"));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body).toEqual({ error: "Unauthorized" });
  });

  it("full middleware() passes through an authenticated protected route", async () => {
    const { middleware } = await importMiddleware();
    const req = makeRequest("/api/reminders", { headers: { authorization: `Bearer ${APP_TOKEN}` } });
    const res = middleware(req);
    // NextResponse.next() has no special status marker we can assert on
    // directly other than it not being our 401 JSON body.
    expect(res.status).not.toBe(401);
  });

  it("6. exempts /api/auth/login from the app-token gate", async () => {
    const { middleware } = await importMiddleware();
    const res = middleware(makeRequest("/api/auth/login", { method: "POST" }));
    expect(res.status).not.toBe(401);
  });

  it("6. exempts the Google OAuth callback from the app-token gate", async () => {
    const { middleware } = await importMiddleware();
    const res = middleware(makeRequest("/api/integrations/google/callback?code=x&state=y"));
    expect(res.status).not.toBe(401);
  });

  it("6. does NOT exempt the Google OAuth connect route", async () => {
    const { middleware } = await importMiddleware();
    const res = middleware(makeRequest("/api/integrations/google/connect"));
    expect(res.status).toBe(401);
  });

  it("connect route succeeds with a valid session cookie (own authenticated browser)", async () => {
    const { middleware } = await importMiddleware();
    const req = makeRequest("/api/integrations/google/connect", {
      headers: { cookie: "nova_session=authenticated" },
    });
    const res = middleware(req);
    expect(res.status).not.toBe(401);
  });

  it("6. exempts /api/cron/* from the app-token gate (guards itself with CRON_SECRET)", async () => {
    const { middleware } = await importMiddleware();
    const res = middleware(makeRequest("/api/cron/process-due-reminders", { method: "POST" }));
    expect(res.status).not.toBe(401);
  });

  it("4. an APP_ACCESS_TOKEN alone must not satisfy the cron route's own CRON_SECRET check", async () => {
    const { POST } = await import("../app/api/cron/process-due-reminders/route");
    const req = makeRequest("/api/cron/process-due-reminders", {
      method: "POST",
      headers: { authorization: `Bearer ${APP_TOKEN}` },
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it("9. a failed auth response never leaks the configured secret value", async () => {
    const { middleware } = await importMiddleware();
    const res = middleware(makeRequest("/api/reminders", { headers: { authorization: "Bearer nope" } }));
    const text = await res.text();
    expect(text).not.toContain(APP_TOKEN);
    expect(text).not.toContain(CRON_TOKEN);
  });

  it("10. the auth-check code path never logs the token", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { isAuthorizedRequest } = await importMiddleware();
    isAuthorizedRequest(makeRequest("/api/reminders", { headers: { authorization: `Bearer ${APP_TOKEN}` } }));
    isAuthorizedRequest(makeRequest("/api/reminders", { headers: { authorization: "Bearer wrong" } }));
    const allCalls = [...logSpy.mock.calls, ...errSpy.mock.calls, ...warnSpy.mock.calls].flat();
    expect(allCalls.some((arg) => typeof arg === "string" && arg.includes(APP_TOKEN))).toBe(false);
    logSpy.mockRestore();
    errSpy.mockRestore();
    warnSpy.mockRestore();
  });
});

describe("cron route CRON_SECRET check", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.CRON_SECRET = CRON_TOKEN;
    process.env.APP_ACCESS_TOKEN = APP_TOKEN;
    process.env.NOVA_DATA_SOURCE = "local";
    vi.resetModules();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("5. accepts the correct CRON_SECRET via Authorization header", async () => {
    const { POST } = await import("../app/api/cron/process-due-reminders/route");
    const req = makeRequest("/api/cron/process-due-reminders", {
      method: "POST",
      headers: { authorization: `Bearer ${CRON_TOKEN}` },
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
  });

  it("5b. accepts the correct CRON_SECRET via x-cron-secret header", async () => {
    const { POST } = await import("../app/api/cron/process-due-reminders/route");
    const req = makeRequest("/api/cron/process-due-reminders", {
      method: "POST",
      headers: { "x-cron-secret": CRON_TOKEN },
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
  });

  it("rejects a wrong CRON_SECRET", async () => {
    const { POST } = await import("../app/api/cron/process-due-reminders/route");
    const req = makeRequest("/api/cron/process-due-reminders", {
      method: "POST",
      headers: { "x-cron-secret": "wrong" },
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });
});

describe("protected reminders route cannot be used anonymously", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.APP_ACCESS_TOKEN = APP_TOKEN;
    vi.resetModules();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("7. a protected mutation (create reminder) is blocked by middleware before reaching the handler anonymously", async () => {
    const { middleware } = await importMiddlewareHelper();
    const req = makeRequest("/api/reminders", { method: "POST" });
    const res = middleware(req);
    expect(res.status).toBe(401);
  });

  it("8. a protected read (list reminders) is blocked by middleware before reaching the handler anonymously", async () => {
    const { middleware } = await importMiddlewareHelper();
    const req = makeRequest("/api/reminders", { method: "GET" });
    const res = middleware(req);
    expect(res.status).toBe(401);
  });

  async function importMiddlewareHelper() {
    return await import("../middleware");
  }
});
