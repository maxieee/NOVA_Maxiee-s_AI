import { describe, it, expect, vi, beforeEach } from "vitest";
import { validateSubscriptionPayload } from "@/lib/notifications/validateSubscription";
import { buildPushPayload } from "@/lib/notifications/payload";
import { decideEscalation } from "@/lib/notifications/escalation";
import type { Reminder } from "@/types/reminder";

function makeReminder(overrides: Partial<Reminder> = {}): Reminder {
  return {
    id: "r1",
    user_id: "u1",
    title: "Pay rent",
    description: null,
    date: new Date().toISOString().slice(0, 10),
    time: "09:00",
    priority: "medium",
    notes: null,
    status: "scheduled",
    created_at: "",
    updated_at: "",
    completed_at: null,
    types: ["task"],
    payment: null,
    call: null,
    meeting: null,
    follow_up: null,
    recurrence: null,
    next_occurrence: null,
    channels: ["push"],
    intensity: "normal",
    ...overrides,
  };
}

describe("push subscription payload validation", () => {
  it("accepts a well-formed subscription", () => {
    const error = validateSubscriptionPayload({
      endpoint: "https://fcm.googleapis.com/fcm/send/abc123",
      keys: { p256dh: "p256dh-key", auth: "auth-key" },
    });
    expect(error).toBeNull();
  });

  it("rejects a missing endpoint", () => {
    const error = validateSubscriptionPayload({
      keys: { p256dh: "p256dh-key", auth: "auth-key" },
    });
    expect(error).toMatch(/endpoint/i);
  });

  it("rejects missing keys.p256dh", () => {
    const error = validateSubscriptionPayload({
      endpoint: "https://fcm.googleapis.com/fcm/send/abc123",
      keys: { auth: "auth-key" },
    });
    expect(error).toMatch(/p256dh/i);
  });

  it("rejects missing keys.auth", () => {
    const error = validateSubscriptionPayload({
      endpoint: "https://fcm.googleapis.com/fcm/send/abc123",
      keys: { p256dh: "p256dh-key" },
    });
    expect(error).toMatch(/auth/i);
  });
});

describe("buildPushPayload", () => {
  it("builds gentle copy for normal intensity, due today", () => {
    const reminder = makeReminder({ intensity: "normal" });
    const payload = buildPushPayload(reminder);
    expect(payload.title).toContain("NOVA");
    expect(payload.body).toContain("Pay rent");
    expect(payload.body.toLowerCase()).toContain("due today");
    expect(payload.data).toEqual({ url: "/reminders/r1", reminderId: "r1" });
    expect(payload.actions.map((a) => a.action)).toEqual(["done", "snooze"]);
  });

  it("builds urgent copy for critical/persistent intensity", () => {
    const reminder = makeReminder({ intensity: "critical" });
    const payload = buildPushPayload(reminder);
    expect(payload.title).toMatch(/NOVA/);
    expect(payload.body).toMatch(/Important reminder/);
    expect(payload.body).toContain("due now");
  });

  it("includes the correct reminder id in data.url for a different reminder", () => {
    const reminder = makeReminder({ id: "abc-999" });
    const payload = buildPushPayload(reminder);
    expect(payload.data.url).toBe("/reminders/abc-999");
    expect(payload.data.reminderId).toBe("abc-999");
  });
});

describe("notification channel selection with push", () => {
  it("selects push as the delivered channel when it's requested and configured", () => {
    const action = decideEscalation({
      intensity: "normal",
      requestedChannels: ["push", "sms"],
      configuredChannels: ["push"],
      elapsedMinutes: 200,
      acknowledged: false,
      repeatCount: 0,
    });
    expect(action).toEqual({ type: "notify", channel: "push", escalated: false });
  });

  it("stops when push is requested but not configured and nothing else is available", () => {
    const action = decideEscalation({
      intensity: "normal",
      requestedChannels: ["push"],
      configuredChannels: [],
      elapsedMinutes: 200,
      acknowledged: false,
      repeatCount: 0,
    });
    expect(action).toEqual({ type: "stop", reason: "no_channels_available" });
  });

  it("escalates from push to call for critical intensity once available", () => {
    const action = decideEscalation({
      intensity: "critical",
      requestedChannels: ["push", "call"],
      configuredChannels: ["push", "call"],
      elapsedMinutes: 15,
      acknowledged: false,
      repeatCount: 0,
    });
    expect(action).toEqual({ type: "notify", channel: "call", escalated: true });
  });
});

describe("webpush provider — invalid/expired subscription handling", () => {
  const sendNotificationMock = vi.fn();
  const setVapidDetailsMock = vi.fn();

  beforeEach(() => {
    vi.resetModules();
    sendNotificationMock.mockReset();
    setVapidDetailsMock.mockReset();
    process.env.VAPID_PUBLIC_KEY = "test-public-key";
    process.env.VAPID_PRIVATE_KEY = "test-private-key";
    process.env.VAPID_SUBJECT = "mailto:test@example.com";
  });

  it("returns not_configured (never fakes 'sent') when VAPID keys are missing", async () => {
    delete process.env.VAPID_PUBLIC_KEY;
    delete process.env.VAPID_PRIVATE_KEY;
    delete process.env.VAPID_SUBJECT;

    vi.doMock("web-push", () => ({
      default: { setVapidDetails: setVapidDetailsMock, sendNotification: sendNotificationMock },
    }));
    vi.doMock("@/lib/db", () => ({
      db: {
        listActivePushSubscriptions: vi.fn(() => [
          { id: "s1", user_id: "u1", endpoint: "https://push.example/1", p256dh: "p", auth: "a", active: true, failure_count: 0, last_failure_at: null, created_at: "", updated_at: "" },
        ]),
        deactivatePushSubscription: vi.fn(),
        recordPushFailure: vi.fn(),
      },
    }));

    const { sendPushToUser } = await import("@/lib/notifications/providers/webpush");
    const results = await sendPushToUser("u1", "hello");
    expect(results[0].result.outcome).toBe("not_configured");
    expect(sendNotificationMock).not.toHaveBeenCalled();
  });

  it("deactivates the subscription on a 410 Gone response and reports failed (not sent)", async () => {
    const deactivate = vi.fn();
    sendNotificationMock.mockRejectedValueOnce(Object.assign(new Error("Gone"), { statusCode: 410 }));

    vi.doMock("web-push", () => ({
      default: { setVapidDetails: setVapidDetailsMock, sendNotification: sendNotificationMock },
    }));
    vi.doMock("@/lib/db", () => ({
      db: {
        listActivePushSubscriptions: vi.fn(() => [
          { id: "s1", user_id: "u1", endpoint: "https://push.example/expired", p256dh: "p", auth: "a", active: true, failure_count: 0, last_failure_at: null, created_at: "", updated_at: "" },
        ]),
        deactivatePushSubscription: deactivate,
        recordPushFailure: vi.fn(),
      },
    }));

    const { sendPushToUser } = await import("@/lib/notifications/providers/webpush");
    const results = await sendPushToUser("u1", "hello");

    expect(results[0].result.outcome).toBe("failed");
    expect(deactivate).toHaveBeenCalledWith("https://push.example/expired");
  });

  it("reports a real 'sent' outcome only when sendNotification actually resolves", async () => {
    sendNotificationMock.mockResolvedValueOnce(undefined);

    vi.doMock("web-push", () => ({
      default: { setVapidDetails: setVapidDetailsMock, sendNotification: sendNotificationMock },
    }));
    vi.doMock("@/lib/db", () => ({
      db: {
        listActivePushSubscriptions: vi.fn(() => [
          { id: "s1", user_id: "u1", endpoint: "https://push.example/ok", p256dh: "p", auth: "a", active: true, failure_count: 0, last_failure_at: null, created_at: "", updated_at: "" },
        ]),
        deactivatePushSubscription: vi.fn(),
        recordPushFailure: vi.fn(),
      },
    }));

    const { sendPushToUser } = await import("@/lib/notifications/providers/webpush");
    const results = await sendPushToUser("u1", "hello");

    expect(results[0].result.outcome).toBe("sent");
    expect(sendNotificationMock).toHaveBeenCalledTimes(1);
  });
});
