import { NextRequest, NextResponse } from "next/server";
import { isValidAppToken, SESSION_COOKIE_NAME, sessionCookieValue } from "@/lib/auth/appAccessToken";

/**
 * The one deliberate exception (alongside cron and the Google OAuth
 * callback) to "all /api/* routes require APP_ACCESS_TOKEN": you can't
 * present a session cookie you don't have yet. This route trades the raw
 * token, once, for an httpOnly session cookie. It is otherwise a normal
 * protected surface: it never echoes the token back, never logs it, and a
 * wrong token gets the same generic 401 as everywhere else.
 */
export async function POST(req: NextRequest) {
  let token: string | null = null;
  try {
    const body = await req.json();
    if (typeof body?.token === "string") token = body.token;
  } catch {
    // fall through to header form below
  }
  if (!token) {
    const authHeader = req.headers.get("authorization");
    token = authHeader?.replace(/^Bearer\s+/i, "") ?? null;
  }

  if (!isValidAppToken(token)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE_NAME, sessionCookieValue(), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    // No fixed expiry: this is a personal single-device PWA session, not a
    // multi-user product needing forced re-auth. Cleared explicitly via
    // /api/auth/logout when the user wants to.
  });
  return res;
}
