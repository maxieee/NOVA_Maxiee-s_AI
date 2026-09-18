import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { computeRescheduleRecommendations, MIN_CLUSTER_RATIO } from "../lib/analytics/recommendations";
import { MIN_SNOOZE_COUNT } from "../lib/analytics/insights";
import type { SnoozePattern } from "../lib/analytics/metrics";

describe("computeRescheduleRecommendations — pure, no side effects", () => {
  it("produces nothing below the minimum snooze count", () => {
    const patterns: SnoozePattern[] = [
      { reminderId: "r1", title: "Take vitamins", snoozeCount: MIN_SNOOZE_COUNT - 1, resultingHours: [9, 9, 9] },
    ];
    expect(computeRescheduleRecommendations(patterns)).toHaveLength(0);
  });

  it("produces nothing when the resulting hours don't cluster consistently", () => {
    const patterns: SnoozePattern[] = [
      { reminderId: "r1", title: "Take vitamins", snoozeCount: MIN_SNOOZE_COUNT, resultingHours: [8, 12, 20] },
    ];
    expect(computeRescheduleRecommendations(patterns)).toHaveLength(0);
  });

  it("recommends the clustered hour once threshold + consistency are both met", () => {
    const patterns: SnoozePattern[] = [
      { reminderId: "r1", title: "Take vitamins", snoozeCount: MIN_SNOOZE_COUNT, resultingHours: [9, 9, 9] },
    ];
    const recs = computeRescheduleRecommendations(patterns);
    expect(recs).toHaveLength(1);
    expect(recs[0].action).toEqual({ kind: "reschedule", reminderId: "r1", newTime: "09:00" });
    expect(recs[0].id).toBe("reschedule_default_time:r1");
    // Ratio must be at least MIN_CLUSTER_RATIO — documented, not incidental.
    expect(MIN_CLUSTER_RATIO).toBeGreaterThan(0.5);
  });
});

describe("applyRecommendation / dismissRecommendation — real DB, proves nothing auto-applies", () => {
  const dbPaths: string[] = [];

  beforeAll(async () => {
    await import("../lib/db");
    await import("../lib/analytics/report");
    await import("../lib/analytics/apply");
  });

  beforeEach(() => {
    vi.resetModules();
    const dbPath = path.join(os.tmpdir(), `nova-analytics-recs-test-${Date.now()}-${Math.random()}.sqlite`);
    dbPaths.push(dbPath);
    process.env.NOVA_SQLITE_PATH = dbPath;
    process.env.NOVA_DATA_SOURCE = "local";
  });

  afterAll(() => {
    for (const p of dbPaths) {
      for (const suffix of ["", "-wal", "-shm"]) {
        try {
          fs.unlinkSync(p + suffix);
        } catch {
          /* ignore */
        }
      }
    }
  });

  it("computing/generating a recommendation never mutates the reminder it's about", async () => {
    const { db } = await import("../lib/db");
    const { buildAnalyticsReport } = await import("../lib/analytics/report");
    const userId = db.getCurrentUserId();

    const reminder = db.createReminder(userId, {
      title: "Take vitamins",
      date: "2026-01-01",
      time: "08:00",
      priority: "medium",
      types: ["general"],
    });

    for (let i = 0; i < MIN_SNOOZE_COUNT; i++) {
      db.snoozeReminder(reminder.id, 15);
    }

    const before = db.getReminder(reminder.id)!;
    // Generating the report computes insights/recommendations from real data.
    buildAnalyticsReport(userId);
    const after = db.getReminder(reminder.id)!;

    // Merely computing/persisting a pending recommendation row must not touch the reminder itself.
    expect(after.date).toBe(before.date);
    expect(after.time).toBe(before.time);
    expect(after.updated_at).toBe(before.updated_at);
  });

  it("apply actually reschedules via the existing db.rescheduleReminder path and marks the recommendation applied", async () => {
    const { db } = await import("../lib/db");
    const { applyRecommendation } = await import("../lib/analytics/apply");
    const userId = db.getCurrentUserId();

    const reminder = db.createReminder(userId, {
      title: "Take vitamins",
      date: "2026-01-01",
      time: "08:00",
      priority: "medium",
      types: ["general"],
    });

    const recId = `reschedule_default_time:${reminder.id}`;
    db.ensureRecommendation(userId, recId, {
      type: "reschedule_default_time",
      subjectType: "reminder",
      subjectId: reminder.id,
      payload: JSON.stringify({ kind: "reschedule", reminderId: reminder.id, newTime: "09:00" }),
    });

    const beforeApply = db.getReminder(reminder.id)!;
    expect(beforeApply.time).toBe("08:00");

    const applied = applyRecommendation(recId);
    expect(applied?.status).toBe("applied");

    const afterApply = db.getReminder(reminder.id)!;
    expect(afterApply.time).toBe("09:00");

    // Applying again is a no-op (already applied, not pending) — proves it never re-runs silently.
    const secondCall = applyRecommendation(recId);
    expect(secondCall?.status).toBe("applied");
  });

  it("dismiss marks the recommendation dismissed without touching the reminder", async () => {
    const { db } = await import("../lib/db");
    const { dismissRecommendation } = await import("../lib/analytics/apply");
    const userId = db.getCurrentUserId();

    const reminder = db.createReminder(userId, {
      title: "Take vitamins",
      date: "2026-01-01",
      time: "08:00",
      priority: "medium",
      types: ["general"],
    });

    const recId = `reschedule_default_time:${reminder.id}`;
    db.ensureRecommendation(userId, recId, {
      type: "reschedule_default_time",
      subjectType: "reminder",
      subjectId: reminder.id,
      payload: JSON.stringify({ kind: "reschedule", reminderId: reminder.id, newTime: "09:00" }),
    });

    const before = db.getReminder(reminder.id)!;
    const dismissed = dismissRecommendation(recId);
    expect(dismissed?.status).toBe("dismissed");
    const after = db.getReminder(reminder.id)!;
    expect(after.time).toBe(before.time);
  });
});
