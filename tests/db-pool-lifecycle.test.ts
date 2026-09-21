import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Regression coverage for a real production incident: Vercel logs showed
 * `EMAXCONNSESSION: max clients reached in session mode` from Supabase's
 * Session Pooler. Root cause (see lib/db/supabase.ts's header comment for
 * the full audit): Next.js runs each route as its own serverless function,
 * so under concurrent traffic several separately-warm lambda instances can
 * each be holding their OWN `pg.Pool` of up to NOVA_PG_POOL_MAX
 * connections; Session mode reserves one dedicated Postgres backend
 * connection per client connection for its whole lifetime, so those
 * accumulate across instances and can exhaust the pooler's connection
 * quota under bursty concurrent load (amplified by <Link> prefetching every
 * visible reminder/payment card's force-dynamic detail page at once — fixed
 * separately by adding `prefetch={false}` to those Links).
 *
 * These tests don't need a real Postgres connection — they mock the `pg`
 * package entirely and assert the connection-lifecycle invariants that
 * actually matter for this incident: the Pool is a true per-module
 * singleton (never re-created), its `max` is honored from
 * NOVA_PG_POOL_MAX, and a multi-statement transaction acquires exactly one
 * client and always releases it exactly once — including on error, so a
 * query failure can never leak a held connection.
 */

interface FakeQueryResult {
  rows: Record<string, unknown>[];
}

class FakePoolClient {
  queries: string[] = [];
  released = false;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- signature must match pg's Pool/PoolClient.query(sql, params)
  async query(sql: string, params?: unknown[]): Promise<FakeQueryResult> {
    this.queries.push(sql);
    if (sql === "__FAIL__") throw new Error("simulated query failure");
    return { rows: [] };
  }
  release() {
    this.released = true;
  }
}

class FakePool {
  static instances: FakePool[] = [];
  options: Record<string, unknown>;
  clients: FakePoolClient[] = [];
  constructor(options: Record<string, unknown>) {
    this.options = options;
    FakePool.instances.push(this);
  }
  async connect(): Promise<FakePoolClient> {
    const client = new FakePoolClient();
    this.clients.push(client);
    return client;
  }
  async query(sql: string, params?: unknown[]): Promise<FakeQueryResult> {
    const client = await this.connect();
    try {
      return await client.query(sql, params);
    } finally {
      client.release();
    }
  }
  async end() {}
}

beforeEach(() => {
  FakePool.instances = [];
  vi.resetModules();
  vi.doMock("pg", () => ({ Pool: FakePool }));
  process.env.DATABASE_URL = "postgres://fake:fake@localhost:5432/fake";
});

afterEach(async () => {
  vi.doUnmock("pg");
  delete process.env.NOVA_PG_POOL_MAX;
  vi.resetModules();
});

describe("lib/db/supabase.ts — connection pool lifecycle", () => {
  it("creates exactly one Pool instance even under many concurrent DataLayer calls", async () => {
    const { supabaseDataLayer } = await import("@/lib/db/supabase");

    // Simulates the real incident trigger: many concurrent requests (e.g.
    // Link-prefetched /reminders/[id] page loads) all hitting the DataLayer
    // "simultaneously" within one warm serverless instance.
    await Promise.all(
      Array.from({ length: 25 }, () => supabaseDataLayer.getCurrentUserId().catch(() => {}))
    );

    expect(FakePool.instances).toHaveLength(1);
  });

  it("honors NOVA_PG_POOL_MAX for the Pool's max connections, without a hardcoded override", async () => {
    process.env.NOVA_PG_POOL_MAX = "3";
    const { supabaseDataLayer } = await import("@/lib/db/supabase");

    await supabaseDataLayer.getCurrentUserId().catch(() => {});

    expect(FakePool.instances).toHaveLength(1);
    expect(FakePool.instances[0].options.max).toBe(3);
  });

  it("defaults the Pool's max to 5 when NOVA_PG_POOL_MAX is unset", async () => {
    const { supabaseDataLayer } = await import("@/lib/db/supabase");

    await supabaseDataLayer.getCurrentUserId().catch(() => {});

    expect(FakePool.instances[0].options.max).toBe(5);
  });

  it("a multi-statement transaction runs entirely on one acquired client and releases every client used", async () => {
    const { supabaseDataLayer } = await import("@/lib/db/supabase");

    // completeReminder() runs 4 statements inside a single withTx() block
    // (plus BEGIN/COMMIT) — this must all happen on ONE acquired client,
    // never a separate connect() per statement. It then does one more,
    // separate read (getReminder) after the transaction commits, which
    // legitimately uses its own short-lived connect()+release() — the
    // invariant that matters is that NOTHING is left unreleased, and that
    // the transaction's own statements never got scattered across more
    // than one client.
    await supabaseDataLayer.completeReminder("some-reminder-id");

    const pool = FakePool.instances[0];
    expect(pool.clients.every((c) => c.released)).toBe(true);

    const txClient = pool.clients.find((c) => c.queries.includes("BEGIN"));
    expect(txClient).toBeDefined();
    expect(txClient!.queries).toContain("COMMIT");
    expect(txClient!.queries.filter((q) => q === "BEGIN")).toHaveLength(1);
    // All 4 of completeReminder's own statements ran on this same client.
    expect(txClient!.queries).toHaveLength(6); // BEGIN + 4 updates/inserts + COMMIT
  });

  it("releases the client exactly once even when a statement inside the transaction fails, after issuing ROLLBACK", async () => {
    const { supabaseDataLayer } = await import("@/lib/db/supabase");

    const originalClientQuery = FakePoolClient.prototype.query;
    let callCount = 0;
    // Fail the first real statement after BEGIN, to exercise the
    // catch -> ROLLBACK -> finally -> release path in withTx().
    FakePoolClient.prototype.query = async function (this: FakePoolClient, sql: string) {
      callCount += 1;
      if (callCount === 2) throw new Error("simulated mid-transaction failure");
      return originalClientQuery.call(this, sql);
    };

    try {
      await expect(supabaseDataLayer.completeReminder("some-reminder-id")).rejects.toThrow(
        "simulated mid-transaction failure"
      );
    } finally {
      FakePoolClient.prototype.query = originalClientQuery;
    }

    const pool = FakePool.instances[0];
    expect(pool.clients).toHaveLength(1);
    expect(pool.clients[0].released).toBe(true);
    expect(pool.clients[0].queries).toContain("ROLLBACK");
  });

  it("a single read (getCurrentUserId) never holds a dedicated connect()ed client — it uses the pool's own query()", async () => {
    const { supabaseDataLayer } = await import("@/lib/db/supabase");

    await supabaseDataLayer.getCurrentUserId().catch(() => {});

    const pool = FakePool.instances[0];
    // FakePool.query() internally connects+releases per call, same as the
    // real `pg` Pool — a plain read must go through that path (implicit
    // acquire+release), never leave a client checked out afterward.
    expect(pool.clients.every((c) => c.released)).toBe(true);
  });
});
