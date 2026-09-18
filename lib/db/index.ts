import type { DataLayer } from "./types";
import { localDataLayer } from "./local";

/**
 * Single entry point the rest of the app imports. Selects the local SQLite
 * layer by default; set NOVA_DATA_SOURCE=supabase (with the required env
 * vars) to point at a real backend. See lib/db/supabase.ts for the
 * migration path.
 */
function resolveDataLayer(): DataLayer {
  const source = process.env.NOVA_DATA_SOURCE ?? "local";

  if (source === "supabase") {
    throw new Error(
      "NOVA_DATA_SOURCE=supabase is set, but the Supabase DataLayer implementation is not " +
        "wired up in this build (see lib/db/supabase.ts). Falling back is disabled to avoid " +
        "silently using the wrong data source — implement SupabaseDataLayer or unset NOVA_DATA_SOURCE."
    );
  }

  return localDataLayer;
}

export const db: DataLayer = resolveDataLayer();
export type { DataLayer, ReminderFilter } from "./types";
