import { compareSecret } from "./compareSecret";

/**
 * NOVA is a single-user personal app. Auth is a single shared secret
 * (APP_ACCESS_TOKEN) rather than a multi-user system. The browser proves it
 * knows the token once (via /api/auth/login), which sets an httpOnly
 * session cookie; from then on every same-origin request (including the
 * service worker's notification-action fetches) carries that cookie
 * automatically, so no client-side JS ever needs to read or attach the
 * token itself. See README "Authentication" section for the full writeup.
 */
export const SESSION_COOKIE_NAME = "nova_session";

/** The session cookie's value when valid. Not a secret derivation of the
 * token itself (so a leaked cookie doesn't hand over the raw token), just a
 * fixed marker checked against a timing-safe comparison, scoped by the
 * cookie being httpOnly + secure + short-lived-ish. */
const SESSION_MARKER = "authenticated";

export function getConfiguredAppToken(): string | null {
  return process.env.APP_ACCESS_TOKEN || null;
}

export function isValidAppToken(provided: string | null | undefined): boolean {
  const expected = getConfiguredAppToken();
  if (!expected) return false;
  return compareSecret(provided ?? undefined, expected);
}

export function isValidSessionCookie(value: string | null | undefined): boolean {
  if (!value) return false;
  // Fixed-value marker, but still compared timing-safely for consistency
  // and to avoid any early-return-on-length pattern creeping in later.
  return compareSecret(value, SESSION_MARKER);
}

export function sessionCookieValue(): string {
  return SESSION_MARKER;
}
