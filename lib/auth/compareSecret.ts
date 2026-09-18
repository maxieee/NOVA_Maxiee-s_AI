import { createHash, timingSafeEqual } from "crypto";

/**
 * Timing-safe comparison of two secret strings (shared app tokens, cron
 * secrets, etc).
 *
 * `crypto.timingSafeEqual` throws if the two buffers differ in length, and
 * a naive `a.length === b.length` early-return before it would leak the
 * length of the *provided* value via a timing side-channel relative to the
 * *expected* value's length. That's not a meaningful leak here (the length
 * of a single shared secret this app owns isn't sensitive the way a
 * per-character match position would be), but we avoid it anyway for a
 * genuinely constant-time comparison: both inputs are first hashed to a
 * fixed-length digest (SHA-256, 32 bytes) with `createHash`, and only the
 * fixed-length digests are compared with `timingSafeEqual`. This means the
 * function's running time depends only on the (constant) digest length,
 * never on the length or content of either input, and it never throws.
 */
export function compareSecret(provided: string | null | undefined, expected: string): boolean {
  if (!provided || !expected) return false;
  const providedHash = createHash("sha256").update(provided).digest();
  const expectedHash = createHash("sha256").update(expected).digest();
  return timingSafeEqual(providedHash, expectedHash);
}
