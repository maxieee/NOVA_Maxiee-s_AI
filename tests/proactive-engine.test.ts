import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";

/**
 * Integration coverage for V8 Proactive Intelligence's impure orchestrator
 * (lib/proactive/engine.ts) against a real scratch SQLite DB. Follows the
 * same os.tmpdir() + pre-warm pattern as tests/payment-integration.test.ts
 * and tests/assistant-execution.test.ts (see commit cc6bce0).
 */
describe("Proactive Intelligence engine — anti-spam + honest delivery", () => {
  const dbPaths: string[] = [];

  beforeAll(async () => {
    await import("../lib/db");
    await import("../lib/scheduling/paymentCycles");
    await import("../lib/proactive/engine");
  });

  beforeEach(() => {
    vi.resetModules();
    const dbPath = path.join(os.tmpdir(), `nova-proactive-engine-test-${Date.now()}-${Math.random()}.sqlite`);
    dbPaths.push(dbPath);
    process.env.NOVA_SQLITE_PATH = dbPath;
    process.env.NOVA_DATA_SOURCE = "local";
    delete process.env.TWILIO_ACCOUNT_SID;
    delete process.env.TWILIO_AUTH_TOKEN;
    delete process.env.TWILIO_PHONE_NUMBER;
    delete process.env.VAPID_PUBLIC_KEY;
    delete process.env.VAPID_PRIVATE_KEY;
  });

  afterAll(() => {
    for (const p of dbPaths) {
      try {
        fs.unlinkSync(p);
      } catch {
        /* ignore */
      }
    }
  });

  it("detects an overdue payment cycle and honestly reports not_configured (no channel wired up)", async () => {
    const { db } = await import("../lib/db");
    const { runProactiveIntelligence } = await import("../lib/proactive/engine");
    const { refreshCycleStatuses } = await import("../lib/scheduling/paymentCycles");

    const userId = await db.getCurrentUserId();
    const account = await db.createPaymentAccount(userId, {
      name: "Test Card",
      payment_type: "CREDIT_CARD",
      issuer: null,
      masked_identifier: null,
      active: true,
      statement_date_rule: 1,
      due_date_rule: "fixed_day",
      fixed_due_day: 1,
      due_days_after_statement: null,
      default_amount: 250,
      minimum_amount: null,
      autopay_enabled: false,
      reminder_enabled: true,
      escalation_enabled: true,
    });
    const cycle = await db.createPaymentCycle(account.id, {
      cyclePeriod: "2020-01",
      statementDate: "2020-01-01",
      dueDate: "2020-01-10", // long overdue relative to real "now"
      amount: 250,
      minimumAmount: null,
    });

    refreshCycleStatuses(userId);
    const results = await runProactiveIntelligence();
    const mine = results.find((r) => r.subjectId === cycle.id);
    expect(mine).toBeDefined();
    expect(mine?.ruleId).toBe("payment_overdue");
    expect(mine?.outcome).toBe("not_configured"); // never fakes "sent"

    const history = await db.listProactiveNotifications(userId);
    expect(history.some((h) => h.subject_id === cycle.id && h.outcome === "not_configured")).toBe(true);
  });

  it("does not double-notify: a second evaluation within the cooldown window is suppressed", async () => {
    const { db } = await import("../lib/db");
    const { runProactiveIntelligence } = await import("../lib/proactive/engine");
    const { refreshCycleStatuses } = await import("../lib/scheduling/paymentCycles");

    const userId = await db.getCurrentUserId();
    const account = await db.createPaymentAccount(userId, {
      name: "Test Card",
      payment_type: "CREDIT_CARD",
      issuer: null,
      masked_identifier: null,
      active: true,
      statement_date_rule: 1,
      due_date_rule: "fixed_day",
      fixed_due_day: 1,
      due_days_after_statement: null,
      default_amount: 250,
      minimum_amount: null,
      autopay_enabled: false,
      reminder_enabled: true,
      escalation_enabled: true,
    });
    await db.createPaymentCycle(account.id, {
      cyclePeriod: "2020-01",
      statementDate: "2020-01-01",
      dueDate: "2020-01-10",
      amount: 250,
      minimumAmount: null,
    });

    refreshCycleStatuses(userId);
    const first = await runProactiveIntelligence();
    expect(first.some((r) => r.ruleId === "payment_overdue" && r.outcome === "not_configured")).toBe(true);

    const second = await runProactiveIntelligence();
    expect(second.some((r) => r.ruleId === "payment_overdue" && r.outcome === "suppressed_cooldown")).toBe(
      true
    );

    // The history must reflect exactly one real logged attempt, not two.
    const attempts = (await db.listProactiveNotifications(userId)).filter((h) => h.rule_id === "payment_overdue");
    expect(attempts).toHaveLength(1);
  });

  it("suppresses alerts during quiet hours but still records them (so cooldown still applies)", async () => {
    const { db } = await import("../lib/db");
    const { runProactiveIntelligence } = await import("../lib/proactive/engine");
    const { refreshCycleStatuses } = await import("../lib/scheduling/paymentCycles");

    const userId = await db.getCurrentUserId();
    // now is fixed inside runProactiveIntelligence to real time; set a quiet
    // window that always contains "now" so this is deterministic regardless
    // of when the test runs.
    await db.updatePreferences(userId, { quiet_hours_start: "00:00", quiet_hours_end: "23:59" });

    const account = await db.createPaymentAccount(userId, {
      name: "Test Card",
      payment_type: "CREDIT_CARD",
      issuer: null,
      masked_identifier: null,
      active: true,
      statement_date_rule: 1,
      due_date_rule: "fixed_day",
      fixed_due_day: 1,
      due_days_after_statement: null,
      default_amount: 250,
      minimum_amount: null,
      autopay_enabled: false,
      reminder_enabled: true,
      escalation_enabled: true,
    });
    await db.createPaymentCycle(account.id, {
      cyclePeriod: "2020-01",
      statementDate: "2020-01-01",
      dueDate: "2020-01-10",
      amount: 250,
      minimumAmount: null,
    });

    refreshCycleStatuses(userId);
    const results = await runProactiveIntelligence();
    expect(results.some((r) => r.ruleId === "payment_overdue" && r.outcome === "suppressed_quiet_hours")).toBe(
      true
    );
  });

  it("respects the global proactive_intelligence_enabled toggle", async () => {
    const { db } = await import("../lib/db");
    const { runProactiveIntelligence } = await import("../lib/proactive/engine");
    const { refreshCycleStatuses } = await import("../lib/scheduling/paymentCycles");

    const userId = await db.getCurrentUserId();
    await db.updatePreferences(userId, { proactive_intelligence_enabled: false });

    const account = await db.createPaymentAccount(userId, {
      name: "Test Card",
      payment_type: "CREDIT_CARD",
      issuer: null,
      masked_identifier: null,
      active: true,
      statement_date_rule: 1,
      due_date_rule: "fixed_day",
      fixed_due_day: 1,
      due_days_after_statement: null,
      default_amount: 250,
      minimum_amount: null,
      autopay_enabled: false,
      reminder_enabled: true,
      escalation_enabled: true,
    });
    await db.createPaymentCycle(account.id, {
      cyclePeriod: "2020-01",
      statementDate: "2020-01-01",
      dueDate: "2020-01-10",
      amount: 250,
      minimumAmount: null,
    });

    refreshCycleStatuses(userId);
    const results = await runProactiveIntelligence();
    expect(results).toHaveLength(0);
  });

  it("multiple qualifying rules for the same overdue cluster don't storm: cluster rule fires once, not per reminder", async () => {
    const { db } = await import("../lib/db");
    const { runProactiveIntelligence } = await import("../lib/proactive/engine");

    const userId = await db.getCurrentUserId();
    for (let i = 0; i < 4; i++) {
      await db.createReminder(userId, {
        title: `Overdue task ${i}`,
        date: "2020-01-01",
        time: "09:00",
        priority: "medium",
        types: ["task"],
        channels: ["push"],
        intensity: "normal",
      });
    }

    const results = await runProactiveIntelligence();
    const clusterHits = results.filter((r) => r.ruleId === "overdue_cluster");
    expect(clusterHits).toHaveLength(1);
  });
});
