import { describe, it, expect } from "vitest";
import { decideEscalation } from "@/lib/notifications/escalation";

describe("decideEscalation", () => {
  it("stops once acknowledged, regardless of anything else", () => {
    const action = decideEscalation({
      intensity: "critical",
      requestedChannels: ["push", "call"],
      configuredChannels: ["push", "call"],
      elapsedMinutes: 999,
      acknowledged: true,
      repeatCount: 5,
    });
    expect(action).toEqual({ type: "stop", reason: "acknowledged" });
  });

  it("waits before the intensity's repeat interval has elapsed", () => {
    const action = decideEscalation({
      intensity: "normal",
      requestedChannels: ["push"],
      configuredChannels: ["push"],
      elapsedMinutes: 5,
      acknowledged: false,
      repeatCount: 0,
    });
    expect(action).toEqual({ type: "wait" });
  });

  it("stops when none of the requested channels have a configured provider", () => {
    const action = decideEscalation({
      intensity: "normal",
      requestedChannels: ["call"],
      configuredChannels: [],
      elapsedMinutes: 200,
      acknowledged: false,
      repeatCount: 0,
    });
    expect(action).toEqual({ type: "stop", reason: "no_channels_available" });
  });

  it("repeats on push before escalating for normal intensity", () => {
    const action = decideEscalation({
      intensity: "normal",
      requestedChannels: ["push", "call"],
      configuredChannels: ["push", "call"],
      elapsedMinutes: 200,
      acknowledged: false,
      repeatCount: 0,
    });
    expect(action).toEqual({ type: "notify", channel: "push", escalated: false });
  });

  it("escalates to a call once the repeat threshold is reached and call is available", () => {
    const action = decideEscalation({
      intensity: "normal",
      requestedChannels: ["push", "call"],
      configuredChannels: ["push", "call"],
      elapsedMinutes: 200,
      acknowledged: false,
      repeatCount: 2, // 3rd repeat, meets ESCALATE_AFTER_REPEATS.normal = 3
    });
    expect(action).toEqual({ type: "notify", channel: "call", escalated: true });
  });

  it("critical intensity escalates to call on the very first repeat", () => {
    const action = decideEscalation({
      intensity: "critical",
      requestedChannels: ["call"],
      configuredChannels: ["call"],
      elapsedMinutes: 15,
      acknowledged: false,
      repeatCount: 0,
    });
    expect(action).toEqual({ type: "notify", channel: "call", escalated: true });
  });

  it("gentle intensity never escalates, only repeats on the mildest available channel", () => {
    const action = decideEscalation({
      intensity: "gentle",
      requestedChannels: ["email", "call"],
      configuredChannels: ["email", "call"],
      elapsedMinutes: 500,
      acknowledged: false,
      repeatCount: 50,
    });
    expect(action).toEqual({ type: "notify", channel: "email", escalated: false });
  });

  it("falls back to whatever channel is available when call is desired but not configured", () => {
    const action = decideEscalation({
      intensity: "critical",
      requestedChannels: ["call", "sms"],
      configuredChannels: ["sms"],
      elapsedMinutes: 20,
      acknowledged: false,
      repeatCount: 0,
    });
    expect(action).toEqual({ type: "notify", channel: "sms", escalated: true });
  });
});
