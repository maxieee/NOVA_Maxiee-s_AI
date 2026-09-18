import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { validatePhoneNumber } from "@/lib/notifications/validatePhoneNumber";
import { decideEscalation } from "@/lib/notifications/escalation";

const ENV_KEYS = ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_PHONE_NUMBER"] as const;

function clearTwilioEnv() {
  for (const k of ENV_KEYS) delete process.env[k];
}

function setTwilioEnv() {
  process.env.TWILIO_ACCOUNT_SID = "AC_test_sid";
  process.env.TWILIO_AUTH_TOKEN = "test_token_never_logged";
  process.env.TWILIO_PHONE_NUMBER = "+15550000000";
}

describe("validatePhoneNumber — pure E.164 validator", () => {
  it("4) rejects a number missing the leading '+'", () => {
    expect(validatePhoneNumber("919876543210").valid).toBe(false);
  });

  it("4) rejects a too-short number", () => {
    expect(validatePhoneNumber("+1234").valid).toBe(false);
  });

  it("4) rejects a number containing letters", () => {
    expect(validatePhoneNumber("+91987654321a").valid).toBe(false);
  });

  it("4) rejects empty/missing input with a clear reason", () => {
    const result = validatePhoneNumber(null);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/no phone number/i);
  });

  it("4) never auto-corrects — a number without '+' is rejected, not reformatted", () => {
    const result = validatePhoneNumber("919876543210");
    expect(result.valid).toBe(false);
    expect(result.reason).toBeTruthy();
  });

  it("5) accepts a valid E.164 number", () => {
    expect(validatePhoneNumber("+919876543210").valid).toBe(true);
  });

  it("5) accepts another valid E.164 number (US)", () => {
    expect(validatePhoneNumber("+14155552671").valid).toBe(true);
  });
});

describe("decideEscalation — call channel selection", () => {
  it("1) chooses 'call' only when explicitly requested and configured, once the threshold is met", () => {
    const action = decideEscalation({
      intensity: "critical",
      requestedChannels: ["push", "call"],
      configuredChannels: ["push", "call"],
      elapsedMinutes: 999,
      acknowledged: false,
      repeatCount: 1, // critical escalates after 1 repeat
    });
    expect(action).toEqual({ type: "notify", channel: "call", escalated: true });
  });

  it("2) never chooses 'call' when the reminder didn't request it, even at critical intensity with repeats", () => {
    const action = decideEscalation({
      intensity: "critical",
      requestedChannels: ["push"],
      configuredChannels: ["push", "call"],
      elapsedMinutes: 999,
      acknowledged: false,
      repeatCount: 5,
    });
    expect(action.type).toBe("notify");
    if (action.type === "notify") expect(action.channel).not.toBe("call");
  });

  it("3) never chooses 'call' when Twilio isn't configured (not in configuredChannels), even if requested", () => {
    const action = decideEscalation({
      intensity: "critical",
      requestedChannels: ["call"],
      configuredChannels: [], // Twilio not configured
      elapsedMinutes: 999,
      acknowledged: false,
      repeatCount: 5,
    });
    expect(action).toEqual({ type: "stop", reason: "no_channels_available" });
  });

  it("intensity alone never selects 'call' — channel selection always goes through requestedChannels/configuredChannels", () => {
    const action = decideEscalation({
      intensity: "critical",
      requestedChannels: ["push", "email"],
      configuredChannels: ["push", "email", "call"],
      elapsedMinutes: 999,
      acknowledged: false,
      repeatCount: 10,
    });
    expect(action.type).toBe("notify");
    if (action.type === "notify") expect(action.channel).not.toBe("call");
  });
});

describe("twilioProvider.placeCall — honest outcomes, no real network", () => {
  beforeEach(() => {
    vi.resetModules();
    clearTwilioEnv();
  });
  afterEach(() => {
    clearTwilioEnv();
    vi.unstubAllGlobals();
  });

  it("3) returns not_configured when Twilio env vars are absent, without ever attempting fetch", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const { twilioProvider } = await import("@/lib/notifications/providers/twilio");

    const result = await twilioProvider.placeCall("+919876543210", "Hello");

    expect(result.outcome).toBe("not_configured");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns invalid_number pre-flight (before any Twilio network call) for a malformed destination", async () => {
    setTwilioEnv();
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const { twilioProvider } = await import("@/lib/notifications/providers/twilio");

    const result = await twilioProvider.placeCall("not-a-number", "Hello");

    expect(result.outcome).toBe("invalid_number");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("6) a mocked successful Twilio HTTP response produces {outcome: 'sent', providerRef: <sid>}", async () => {
    setTwilioEnv();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 201,
        json: async () => ({ sid: "CA1234567890" }),
        text: async () => "",
      })
    );
    const { twilioProvider } = await import("@/lib/notifications/providers/twilio");

    const result = await twilioProvider.placeCall("+919876543210", "Reminder: pay rent. It is due now.");

    expect(result.outcome).toBe("sent");
    expect(result.providerRef).toBe("CA1234567890");
  });

  it("never logs the auth token: the fetch call's Authorization header is not surfaced in the result", async () => {
    setTwilioEnv();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({ sid: "CA_ok" }),
      text: async () => "",
    });
    vi.stubGlobal("fetch", fetchMock);
    const { twilioProvider } = await import("@/lib/notifications/providers/twilio");

    const result = await twilioProvider.placeCall("+919876543210", "Hello");

    expect(JSON.stringify(result)).not.toContain(process.env.TWILIO_AUTH_TOKEN);
  });

  it("7) a mocked Twilio failure response produces {outcome: 'failed'}, never 'sent'", async () => {
    setTwilioEnv();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        text: async () => "Invalid 'To' number",
        json: async () => ({}),
      })
    );
    const { twilioProvider } = await import("@/lib/notifications/providers/twilio");

    const result = await twilioProvider.placeCall("+919876543210", "Hello");

    expect(result.outcome).toBe("failed");
  });

  it("TwiML message is XML-escaped for unsafe characters in the reminder title", async () => {
    setTwilioEnv();
    let capturedBody = "";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
        capturedBody = String(init.body);
        return { ok: true, status: 201, json: async () => ({ sid: "CA_x" }), text: async () => "" };
      })
    );
    const { twilioProvider } = await import("@/lib/notifications/providers/twilio");

    await twilioProvider.placeCall("+919876543210", `Renew <license> & "permit"`);
    const decoded = decodeURIComponent(capturedBody.replace(/\+/g, " "));

    expect(decoded).toContain("&lt;license&gt;");
    expect(decoded).toContain("&amp;");
    expect(decoded).not.toContain("<license>");
  });
});

describe("dueScan — call escalation integration (scratch SQLite, mocked provider)", () => {
  const DB_PATH = "e2e-twilio-call-test.sqlite";

  beforeEach(async () => {
    vi.resetModules();
    clearTwilioEnv();
    const fs = await import("fs");
    try {
      fs.unlinkSync(DB_PATH);
    } catch {
      /* ignore */
    }
    process.env.NOVA_SQLITE_PATH = `./${DB_PATH}`;
    process.env.NOVA_DATA_SOURCE = "local";
    process.env.NOVA_FOLLOWUP_SECONDS_NORMAL = "3600"; // don't auto-follow-up mid-test
    process.env.NOVA_ESCALATE_AFTER_NORMAL = "1"; // escalate to call on the very first follow-up
    setTwilioEnv();
  });

  afterEach(async () => {
    clearTwilioEnv();
    const fs = await import("fs");
    try {
      fs.unlinkSync(DB_PATH);
    } catch {
      /* ignore */
    }
  });

  async function setup() {
    const { db } = await import("@/lib/db");
    const { scanAndProcessDueReminders } = await import("@/lib/scheduling/dueScan");
    const { twilioProvider } = await import("@/lib/notifications/providers/twilio");
    return { db, scanAndProcessDueReminders, twilioProvider };
  }

  async function backdate(db: Awaited<ReturnType<typeof setup>>["db"], reminderId: string) {
    const Database = (await import("better-sqlite3")).default;
    const occ = (await db.listOccurrences(reminderId))[0];
    const past = new Date(Date.now() - 60_000).toISOString();
    const sqlite = new Database(DB_PATH);
    sqlite.prepare(`update reminder_occurrences set scheduled_for = ? where id = ?`).run(past, occ.id);
    sqlite.close();
    return occ.id;
  }

  it("2) does not attempt a call when 'call' isn't in the reminder's requested channels", async () => {
    const { db, scanAndProcessDueReminders, twilioProvider } = await setup();
    const placeCallSpy = vi.spyOn(twilioProvider, "placeCall");
    await db.updatePreferences(await db.getCurrentUserId(), { phone_number: "+919876543210", escalation_threshold_repeats: 1 });

    const reminder = await db.createReminder(await db.getCurrentUserId(), {
      title: "Push-only reminder",
      date: new Date().toISOString().slice(0, 10),
      time: "00:00",
      priority: "high",
      types: ["task"],
      intensity: "critical",
      channels: ["push"],
    } as never);
    await backdate(db, reminder.id);

    await scanAndProcessDueReminders();

    expect(placeCallSpy).not.toHaveBeenCalled();
  });

  it("6/7/10) a genuinely sent call advances state exactly once; a failed call never advances it", async () => {
    const { db, scanAndProcessDueReminders, twilioProvider } = await setup();
    await db.updatePreferences(await db.getCurrentUserId(), { phone_number: "+919876543210", escalation_threshold_repeats: 1 });

    // --- Reminder A: mocked success ---
    twilioProvider.placeCall = vi.fn().mockResolvedValue({ outcome: "sent", detail: "ok", providerRef: "CA_ok" });
    const sentReminder = await db.createReminder(await db.getCurrentUserId(), {
      title: "Call-escalated reminder (success)",
      date: new Date().toISOString().slice(0, 10),
      time: "00:00",
      priority: "urgent",
      types: ["task"],
      intensity: "critical",
      channels: ["call"],
    } as never);
    await backdate(db, sentReminder.id);

    await scanAndProcessDueReminders();
    const afterFirst = (await db.listOccurrences(sentReminder.id))[0];
    expect(afterFirst.notification_attempt_count).toBe(1);
    expect(twilioProvider.placeCall).toHaveBeenCalledTimes(1);

    // 10) idempotency: a second run right after must NOT call again.
    await scanAndProcessDueReminders();
    expect(twilioProvider.placeCall).toHaveBeenCalledTimes(1);
    const afterSecond = (await db.listOccurrences(sentReminder.id))[0];
    expect(afterSecond.notification_attempt_count).toBe(1);

    // --- Reminder B: mocked failure — must NOT advance attempt count ---
    twilioProvider.placeCall = vi.fn().mockResolvedValue({ outcome: "failed", detail: "twilio down" });
    const failedReminder = await db.createReminder(await db.getCurrentUserId(), {
      title: "Call-escalated reminder (failure)",
      date: new Date().toISOString().slice(0, 10),
      time: "00:00",
      priority: "urgent",
      types: ["task"],
      intensity: "critical",
      channels: ["call"],
    } as never);
    await backdate(db, failedReminder.id);

    await scanAndProcessDueReminders();
    const failedOcc = (await db.listOccurrences(failedReminder.id))[0];
    expect(failedOcc.notification_attempt_count).toBe(0);
    expect(failedOcc.follow_up_state).not.toBe("escalated");
  });

  it("8) DONE prevents any further call attempt", async () => {
    const { db, scanAndProcessDueReminders, twilioProvider } = await setup();
    await db.updatePreferences(await db.getCurrentUserId(), { phone_number: "+919876543210", escalation_threshold_repeats: 1 });
    twilioProvider.placeCall = vi.fn().mockResolvedValue({ outcome: "sent", detail: "ok", providerRef: "CA_1" });

    const reminder = await db.createReminder(await db.getCurrentUserId(), {
      title: "Done before escalation",
      date: new Date().toISOString().slice(0, 10),
      time: "00:00",
      priority: "urgent",
      types: ["task"],
      intensity: "critical",
      channels: ["call"],
    } as never);
    await backdate(db, reminder.id);

    await db.completeReminder(reminder.id);
    await scanAndProcessDueReminders();

    expect(twilioProvider.placeCall).not.toHaveBeenCalled();
  });
});
