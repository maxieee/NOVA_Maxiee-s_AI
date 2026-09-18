import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Supabase-backed client factory. Not wired into DataLayer with full CRUD
 * in this build (no live credentials in this environment), but provided so
 * switching to real Supabase is a matter of:
 *   1. Running database/migrations/*.sql against your Supabase project
 *   2. Setting the env vars in .env.local
 *   3. Setting NOVA_DATA_SOURCE=supabase
 *   4. Implementing the DataLayer methods below using this client
 *      (the shape mirrors lib/db/local.ts, which you can port table-by-table)
 */
let client: SupabaseClient | null = null;

export function getSupabaseClient(): SupabaseClient {
  if (client) return client;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    throw new Error(
      "Supabase env vars are not set. Add NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY " +
        "to .env.local, or set NOVA_DATA_SOURCE=local to use the bundled SQLite data layer."
    );
  }

  client = createClient(url, key);
  return client;
}

/**
 * TODO when wiring a real Supabase backend: implement DataLayer against
 * getSupabaseClient(), reusing the same table/column names as
 * database/migrations/0001_init.sql. lib/db/local.ts shows the exact
 * queries and join logic to translate.
 */
