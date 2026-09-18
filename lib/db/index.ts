import type { DataLayer } from "./types";
import { localDataLayer } from "./local";

/**
 * Single entry point the rest of the app imports. Selects the local SQLite
 * layer by default; set NOVA_DATA_SOURCE=supabase (with DATABASE_URL / the
 * Supabase env vars set) to point at a real Postgres backend. See
 * lib/db/supabase.ts for the implementation and .env.example for the
 * required variables.
 */
function resolveDataLayer(): DataLayer {
  const source = process.env.NOVA_DATA_SOURCE ?? "local";

  if (source === "supabase" || source === "postgres") {
    // Lazy require so a `local`-only build/test run never even loads the
    // `pg` module or touches Postgres-only env vars.
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- intentional lazy load, see above
    const { supabaseDataLayer } = require("./supabase") as typeof import("./supabase");
    return supabaseDataLayer;
  }

  return localDataLayer;
}

export const db: DataLayer = resolveDataLayer();
export type { DataLayer, ReminderFilter } from "./types";
