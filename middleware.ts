import { NextRequest, NextResponse } from "next/server";
import { isValidAppToken, isValidSessionCookie, SESSION_COOKIE_NAME } from "@/lib/auth/appAccessToken";

/**
 * Default-deny gate in front of every /api/* route (see config.matcher
 * below). NOVA is single-user, so this is a single shared secret
 * (APP_ACCESS_TOKEN), not a multi-user auth system.
 *
 * A request is let through if either:
 *   - it carries a valid `Authorization: Bearer <APP_ACCESS_TOKEN>` header
 *     (useful for curl/scripts/manual API use), or
 *   - it carries the httpOnly `nova_session` cookie set by
 *     POST /api/auth/login after presenting that same token once.
 *
 * The cookie path is what the actual frontend uses: every client component
 * that calls fetch("/api/...") does so same-origin with no auth header
 * attached (confirmed by inspection: ChatPanel, the Settings forms,
 * PaymentActions, ReminderActions, AutomationsManager, etc. all just call
 * fetch()), and the service worker's own fetch calls for notification
 * action buttons (public/sw.js, POST /api/reminders/:id/done|snooze) are
 * also same-origin with no way to attach a bearer header. Same-origin
 * fetches (including from a service worker) send cookies automatically, so
 * an httpOnly session cookie protects all of this transparently with zero
 * changes needed in any client component or in sw.js itself. A
 * JS-readable bearer token stored in localStorage was considered and
 * rejected: it would need every one of those ~12 call sites (and sw.js) to
 * be touched to attach it, and it would be readable by any script running
 * on the page, for no benefit over the cookie for this single-user PWA.
 *
 * EXEMPT PATHS (small, explicit, individually justified):
 *   - /api/cron/*            — protected by its own separate CRON_SECRET
 *                              check inside the route handler (Vercel's
 *                              cron scheduler cannot present an
 *                              APP_ACCESS_TOKEN bearer header or this
 *                              session cookie; APP_ACCESS_TOKEN must never
 *                              substitute for CRON_SECRET here, so this
 *                              route is deliberately left for the handler
 *                              to guard itself, not "open").
 *   - /api/integrations/google/callback — Google's own redirect back to
 *                              this app is an unauthenticated GET from
 *                              Google's servers; it cannot carry a bearer
 *                              header or our session cookie either. It
 *                              remains protected by its existing
 *                              state-cookie CSRF check (nova_google_oauth_state,
 *                              set only by our own /connect redirect and
 *                              consumed exactly once), which is sufficient
 *                              on its own: an attacker cannot forge a
 *                              request Google never sent without first
 *                              knowing that single-use, httpOnly,
 *                              short-lived (10 min) state value.
 *   - /api/auth/login         — has to be reachable without a session
 *                              cookie (that's what it creates) or a bearer
 *                              header (a browser session has neither
 *                              yet); it is itself gated on APP_ACCESS_TOKEN
 *                              inside the handler.
 *
 * Google's /connect route is intentionally NOT exempted: only the app's
 * one authenticated user should be able to kick off linking a Google
 * account, and it's a normal same-origin browser navigation so the session
 * cookie is sent automatically — no special-casing needed.
 */

const EXEMPT_EXACT = new Set(["/api/integrations/google/callback", "/api/auth/login"]);

function isExempt(pathname: string): boolean {
  if (pathname.startsWith("/api/cron/")) return true;
  if (EXEMPT_EXACT.has(pathname)) return true;
  return false;
}

export function isAuthorizedRequest(req: NextRequest): boolean {
  const authHeader = req.headers.get("authorization");
  const bearer = authHeader?.replace(/^Bearer\s+/i, "") ?? null;
  if (isValidAppToken(bearer)) return true;

  const cookie = req.cookies.get(SESSION_COOKIE_NAME)?.value ?? null;
  if (isValidSessionCookie(cookie)) return true;

  return false;
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (isExempt(pathname)) {
    return NextResponse.next();
  }

  if (!isAuthorizedRequest(req)) {
    // Generic body: never distinguishes missing vs. wrong token, never
    // echoes what was compared, no stack trace.
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/api/:path*"],
  // Node.js middleware runtime (stable since Next.js 15.2+): needed so
  // lib/auth/compareSecret.ts can use Node's `crypto.timingSafeEqual`
  // rather than reimplementing it on the Edge runtime's Web Crypto subset.
  runtime: "nodejs",
};
