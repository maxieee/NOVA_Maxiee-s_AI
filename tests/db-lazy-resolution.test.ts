import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Regression test for a real production bug: GET /today (and every other
 * page/route calling db.*) threw
 *   TypeError: Cannot read properties of undefined (reading 'getCurrentUserId')
 * whenever NOVA_DATA_SOURCE=supabase, because lib/db/index.ts used to
 * synchronously `require("./supabase")` and destructure `supabaseDataLayer`
 * from the result at module-eval time. In Next.js's production server
 * bundle, lib/db/supabase.ts (which imports `pg`) is compiled as a webpack
 * "async module" — a synchronous require of it returns before its exports
 * exist, so `supabaseDataLayer` (and therefore the whole exported `db`)
 * was `undefined`.
 *
 * This never surfaced in `npm test` because every other test uses the
 * default `local` data source. These tests simulate the exact failure
 * condition instead: an underlying data-layer module whose resolution is
 * genuinely asynchronous (a real Promise that resolves later, exactly like
 * a dynamic `import()` of an async module would), and assert `db` is never
 * undefined and correctly awaits it before delegating.
 */

const ORIGINAL_NOVA_DATA_SOURCE = process.env.NOVA_DATA_SOURCE;

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  if (ORIGINAL_NOVA_DATA_SOURCE === undefined) {
    delete process.env.NOVA_DATA_SOURCE;
  } else {
    process.env.NOVA_DATA_SOURCE = ORIGINAL_NOVA_DATA_SOURCE;
  }
  vi.doUnmock("@/lib/db/supabase");
  vi.resetModules();
});

describe("lib/db/index — lazy DataLayer resolution", () => {
  it("db is never undefined and correctly awaits an asynchronously-resolving supabase module", async () => {
    process.env.NOVA_DATA_SOURCE = "supabase";

    // Simulates the real production condition: the module backing
    // NOVA_DATA_SOURCE=supabase only finishes initializing after a delay
    // (a real async module / dynamic import, not immediately available the
    // instant it's required).
    vi.doMock("@/lib/db/supabase", async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      return {
        supabaseDataLayer: {
          getCurrentUserId: async () => "async-resolved-user-id",
        },
      };
    });

    const { db } = await import("@/lib/db");

    // The exact assertion that would have failed before the fix: `db`
    // itself must never be undefined, immediately after import.
    expect(db).toBeDefined();

    const userId = await db.getCurrentUserId();
    expect(userId).toBe("async-resolved-user-id");
  });

  it("db resolves to the local SQLite layer by default (NOVA_DATA_SOURCE unset)", async () => {
    delete process.env.NOVA_DATA_SOURCE;

    const { db } = await import("@/lib/db");
    expect(db).toBeDefined();

    const userId = await db.getCurrentUserId();
    expect(typeof userId).toBe("string");
    expect(userId.length).toBeGreaterThan(0);
  });

  it("caches the resolved layer so a slow async resolution only happens once", async () => {
    process.env.NOVA_DATA_SOURCE = "supabase";

    let callCount = 0;
    vi.doMock("@/lib/db/supabase", async () => {
      callCount += 1;
      await new Promise((resolve) => setTimeout(resolve, 5));
      return {
        supabaseDataLayer: {
          getCurrentUserId: async () => "user-1",
          getPreferences: async () => ({ user_id: "user-1" }),
        },
      };
    });

    const { db } = await import("@/lib/db");

    // Call two different methods; both go through the same lazy loader.
    await db.getCurrentUserId();
    await (db as unknown as { getPreferences: (id: string) => Promise<unknown> }).getPreferences("user-1");

    expect(callCount).toBe(1);
  });
});
