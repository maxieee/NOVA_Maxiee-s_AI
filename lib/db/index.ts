import type { DataLayer } from "./types";
import { localDataLayer } from "./local";

/**
 * Single entry point the rest of the app imports. Selects the local SQLite
 * layer by default; set NOVA_DATA_SOURCE=supabase (with DATABASE_URL / the
 * Supabase env vars set) to point at a real Postgres backend. See
 * lib/db/supabase.ts for the implementation and .env.example for the
 * required variables.
 *
 * PRODUCTION BUG (fixed here): this used to synchronously
 * `require("./supabase")` and destructure `supabaseDataLayer` from the
 * result at module-eval time. That worked in every local/test run, but in
 * Next.js's production server bundle, lib/db/supabase.ts (which imports
 * `pg`) gets compiled as a webpack "async module" — the ESM/CJS interop
 * shim around `pg` has to be awaited before that module's own exports
 * (including `supabaseDataLayer`) exist. A plain synchronous `require()`
 * of an async module returns *before* that happens, so `supabaseDataLayer`
 * was `undefined` at the moment it was destructured, making the exported
 * `db` itself `undefined` in any deployment with NOVA_DATA_SOURCE=supabase
 * — reproduced locally by starting a production build (`next build` +
 * `next start`) with NOVA_DATA_SOURCE=supabase set: every page/route
 * calling `db.getCurrentUserId()` (today, reminders, etc.) crashed with
 * `TypeError: Cannot read properties of undefined (reading
 * 'getCurrentUserId')`, matching the production error exactly. This never
 * showed up in `npm test` because every test uses the default `local`
 * data source, which never takes this branch.
 *
 * Fixed by resolving the implementation via a real `import()` (properly
 * awaited by the module system, including through any async-module chain)
 * behind a lazily-initialized Proxy, so every existing call site
 * (`await db.someMethod(...)`) keeps working completely unchanged.
 */
let resolvedLayer: DataLayer | null = null;
let resolvingPromise: Promise<DataLayer> | null = null;

function loadDataLayer(): Promise<DataLayer> {
  if (resolvedLayer) return Promise.resolve(resolvedLayer);
  if (resolvingPromise) return resolvingPromise;

  const source = process.env.NOVA_DATA_SOURCE ?? "local";

  resolvingPromise =
    source === "supabase" || source === "postgres"
      ? import("./supabase").then((mod) => (resolvedLayer = mod.supabaseDataLayer))
      : Promise.resolve((resolvedLayer = localDataLayer));

  return resolvingPromise;
}

const lazyMethodCache = new Map<string | symbol, (...args: unknown[]) => Promise<unknown>>();

function lazyMethod(name: string | symbol) {
  let cached = lazyMethodCache.get(name);
  if (!cached) {
    cached = async (...args: unknown[]) => {
      const layer = await loadDataLayer();
      // Call as `layer[name](...)`, not via a detached `const fn = layer[name]`
      // reference — several DataLayer methods call `this.otherMethod(...)`
      // internally (e.g. local.ts's createReminder calls this.getReminder),
      // and extracting the function first would lose that `this` binding.
      return (layer as unknown as Record<string | symbol, (...a: unknown[]) => unknown>)[name](...args);
    };
    lazyMethodCache.set(name, cached);
  }
  return cached;
}

export const db: DataLayer = new Proxy({} as DataLayer, {
  get(_target, prop) {
    // Anything awaiting a value derived from `db` (e.g. `Promise.resolve(x)`
    // where x transitively holds a reference to it, or a debugger/inspector
    // probing the object) checks for a `.then` property to decide whether
    // to treat it as a thenable. Without this guard the Proxy would answer
    // `typeof db.then === "function"` truthily (same as any other prop),
    // making `db` look like a thenable and get incorrectly unwrapped/called
    // as one — surfaced as "fn is not a function" once `then` resolved to a
    // DataLayer method lookup with no matching method. `db` is a plain
    // object, never a promise, so `then` (and other well-known symbols) must
    // fall through to `undefined` like on any ordinary object.
    if (prop === "then" || typeof prop === "symbol") return undefined;
    return lazyMethod(prop);
  },
});
export type { DataLayer, ReminderFilter } from "./types";
