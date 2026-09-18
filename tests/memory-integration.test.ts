import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";

/**
 * V9 integration coverage: real DataLayer CRUD for personal_context_entries
 * (category/source/active round-trip) plus the assistant pipeline actually
 * consulting memory as a fallback default. See tests/assistant-execution.test.ts
 * for why this needs a pre-warm import before any scratch DB path is set.
 */
describe("Long-term memory integration", () => {
  const dbPaths: string[] = [];

  beforeAll(async () => {
    await import("../lib/db");
    await import("../lib/assistant/pipeline");
  });

  beforeEach(() => {
    vi.resetModules();
    const dbPath = path.join(os.tmpdir(), `nova-memory-test-${Date.now()}-${Math.random()}.sqlite`);
    dbPaths.push(dbPath);
    process.env.NOVA_SQLITE_PATH = dbPath;
    process.env.NOVA_DATA_SOURCE = "local";
  });

  afterAll(() => {
    for (const p of dbPaths) {
      try {
        fs.unlinkSync(p);
        fs.unlinkSync(`${p}-wal`);
        fs.unlinkSync(`${p}-shm`);
      } catch {
        /* ignore */
      }
    }
  });

  it("creates a memory only from explicit input and round-trips category/source/active", async () => {
    const { db } = await import("../lib/db");
    const userId = await db.getCurrentUserId();

    const entry = await db.addPersonalContext(userId, {
      category: "reminder_preference",
      label: "preferred reminder time",
      value: "18:00",
      source: "user_entered",
    });

    expect(entry.category).toBe("reminder_preference");
    expect(entry.source).toBe("user_entered");
    expect(entry.active).toBe(true);

    const all = await db.listPersonalContext(userId);
    expect(all.find((e) => e.id === entry.id)).toBeTruthy();
  });

  it("deactivating a memory removes it from retrieval without deleting its history", async () => {
    const { db } = await import("../lib/db");
    const userId = await db.getCurrentUserId();

    const entry = await db.addPersonalContext(userId, {
      category: "reminder_preference",
      label: "preferred reminder time",
      value: "18:00",
    });

    await db.updatePersonalContext(entry.id, { active: false });

    const active = await db.listPersonalContext(userId);
    expect(active.find((e) => e.id === entry.id)).toBeUndefined();

    const all = await db.listPersonalContext(userId, { includeInactive: true });
    const found = all.find((e) => e.id === entry.id);
    expect(found).toBeTruthy();
    expect(found?.active).toBe(false);
  });

  it("the assistant pipeline uses a stored memory as a fallback default, never as an override", async () => {
    const { db } = await import("../lib/db");
    const { handleAssistantMessage } = await import("../lib/assistant/pipeline");
    const userId = await db.getCurrentUserId();

    await db.addPersonalContext(userId, {
      category: "reminder_preference",
      label: "preferred reminder time",
      value: "18:00",
    });

    // No time given -> memory fallback applies.
    const r1 = await handleAssistantMessage(
      "remind me to water the plants tomorrow",
      "mem-session-1",
      new Date("2026-09-18T12:00:00")
    );
    expect(r1.reply).toMatch(/plants/i);
    const created1 = (await db.listReminders(userId)).find((r) => r.title.toLowerCase().includes("water the plants"));
    expect(created1?.time).toBe("18:00");

    // Explicit time given -> current instruction wins, memory ignored.
    const r2 = await handleAssistantMessage(
      "remind me to feed the cat tomorrow at 7am",
      "mem-session-2",
      new Date("2026-09-18T12:00:00")
    );
    expect(r2.reply).toMatch(/cat/i);
    const created2 = (await db.listReminders(userId)).find((r) => r.title.toLowerCase().includes("feed the cat"));
    expect(created2?.time).toBe("07:00");
  });

  it("a deactivated memory is no longer used by the pipeline", async () => {
    const { db } = await import("../lib/db");
    const { handleAssistantMessage } = await import("../lib/assistant/pipeline");
    const userId = await db.getCurrentUserId();

    const entry = await db.addPersonalContext(userId, {
      category: "reminder_preference",
      label: "preferred reminder time",
      value: "18:00",
    });
    await db.updatePersonalContext(entry.id, { active: false });

    await handleAssistantMessage(
      "remind me to walk the dog tomorrow",
      "mem-session-3",
      new Date("2026-09-18T12:00:00")
    );
    const created = (await db.listReminders(userId)).find((r) => r.title.toLowerCase().includes("walk the dog"));
    // Falls through to the structured default (09:00), not the deactivated memory.
    expect(created?.time).toBe("09:00");
  });
});
