import type { FollowUpState, NotificationChannel, ReminderIntensity } from "@/types/reminder";
import {
  FOLLOW_UP_INTERVAL_MINUTES,
  ESCALATE_AFTER_REPEATS as CONFIG_ESCALATE_AFTER_REPEATS,
  maxAttemptsFor,
  escalateAfterFor,
} from "./followUpConfig";

/**
 * Pure, side-effect-free escalation sequencing. No DB/IO here so it is
 * trivially unit-testable (see tests/escalation.test.ts) — mirrors the
 * style of lib/scheduling/recurrence.ts.
 *
 * Given how "loud" a reminder should be (intensity), which channels were
 * requested for it and which of those actually have a configured provider,
 * how long it's been unacknowledged, and how many times it has already
 * repeated, decide what NOVA should do next.
 */

export type EscalationAction =
  | { type: "wait" }
  | { type: "stop"; reason: "acknowledged" | "no_channels_available" }
  | { type: "notify"; channel: NotificationChannel; escalated: boolean };

export interface EscalationInput {
  intensity: ReminderIntensity;
  requestedChannels: NotificationChannel[];
  configuredChannels: NotificationChannel[];
  elapsedMinutes: number;
  acknowledged: boolean;
  repeatCount: number;
  /** Per-user override for how many repeats occur before escalating; falls back to the intensity default when absent/invalid. */
  escalateAfterOverride?: number | null;
}

/**
 * Minutes between repeats, before escalation, per intensity level.
 * Sourced from the centralized, env-overridable lib/notifications/followUpConfig.ts
 * so timing tuning lives in one place instead of being duplicated here.
 */
export const INTENSITY_REPEAT_MINUTES: Record<ReminderIntensity, number> = FOLLOW_UP_INTERVAL_MINUTES;

/**
 * How many unacknowledged repeats happen before NOVA escalates to a call
 * (if the person asked for calls and one is configured). "gentle" never
 * escalates on its own.
 */
export const ESCALATE_AFTER_REPEATS: Record<ReminderIntensity, number> = CONFIG_ESCALATE_AFTER_REPEATS;

const CHANNEL_PRIORITY: NotificationChannel[] = ["push", "sms", "email", "call"];

export function decideEscalation(input: EscalationInput): EscalationAction {
  if (input.acknowledged) {
    return { type: "stop", reason: "acknowledged" };
  }

  if (input.elapsedMinutes < INTENSITY_REPEAT_MINUTES[input.intensity]) {
    return { type: "wait" };
  }

  const available = input.requestedChannels.filter((c) => input.configuredChannels.includes(c));

  if (available.length === 0) {
    return { type: "stop", reason: "no_channels_available" };
  }

  const escalateAfter = escalateAfterFor(input.intensity, input.escalateAfterOverride);
  const shouldEscalate = input.repeatCount + 1 >= escalateAfter;

  if (shouldEscalate && available.includes("call")) {
    return { type: "notify", channel: "call", escalated: true };
  }

  const next = CHANNEL_PRIORITY.find((c) => available.includes(c)) ?? available[0];
  return { type: "notify", channel: next, escalated: shouldEscalate };
}

/**
 * Occurrence-level follow-up decision, layered on top of decideEscalation
 * (the existing decision-maker) with the state that makes cron processing
 * idempotent: an occurrence that already has a `nextFollowUpAt` in the
 * future is a hard "wait", regardless of what decideEscalation would say —
 * this is what stops a cron run seconds after a real send from re-sending.
 *
 * Pure and time-injectable: `now` is passed in rather than read from the
 * system clock, matching the style of lib/scheduling.
 */
export interface FollowUpDecisionInput {
  now: Date;
  followUpState: FollowUpState;
  intensity: ReminderIntensity;
  requestedChannels: NotificationChannel[];
  configuredChannels: NotificationChannel[];
  scheduledFor: string; // ISO
  lastNotifiedAt: string | null;
  nextFollowUpAt: string | null;
  notificationAttemptCount: number;
  escalationLevel: number;
  maxAttempts?: number; // per-user override; falls back to config default
  escalateAfterOverride?: number | null; // per-user override; falls back to config default
}

export type FollowUpDecision =
  | { type: "no_op"; reason: "completed" | "cancelled" | "not_yet_due" | "waiting" }
  | { type: "stop"; reason: "acknowledged" | "no_channels_available" | "max_attempts_reached" }
  | { type: "send"; channel: NotificationChannel; escalated: boolean; isFirst: boolean };

export function decideFollowUp(input: FollowUpDecisionInput): FollowUpDecision {
  if (input.followUpState === "completed") return { type: "no_op", reason: "completed" };
  if (input.followUpState === "cancelled") return { type: "no_op", reason: "cancelled" };

  const now = input.now.getTime();

  if (new Date(input.scheduledFor).getTime() > now) {
    return { type: "no_op", reason: "not_yet_due" };
  }

  // The idempotency gate: a real send already scheduled the next one —
  // running the cron again before that time is a guaranteed no-op no
  // matter what the underlying escalation math would otherwise say.
  if (input.nextFollowUpAt && new Date(input.nextFollowUpAt).getTime() > now) {
    return { type: "no_op", reason: "waiting" };
  }

  const maxAttempts = maxAttemptsFor(input.intensity, input.maxAttempts);
  if (input.notificationAttemptCount >= maxAttempts) {
    return { type: "stop", reason: "max_attempts_reached" };
  }

  const anchor = input.lastNotifiedAt ?? input.scheduledFor;
  const elapsedMinutes = (now - new Date(anchor).getTime()) / 60_000;

  const action = decideEscalation({
    intensity: input.intensity,
    requestedChannels: input.requestedChannels,
    configuredChannels: input.configuredChannels,
    elapsedMinutes: input.notificationAttemptCount === 0 ? Number.POSITIVE_INFINITY : elapsedMinutes,
    acknowledged: false,
    repeatCount: input.notificationAttemptCount,
    escalateAfterOverride: input.escalateAfterOverride,
  });

  if (action.type === "wait") return { type: "no_op", reason: "waiting" };
  if (action.type === "stop") return { type: "stop", reason: action.reason };

  return { type: "send", channel: action.channel, escalated: action.escalated, isFirst: input.notificationAttemptCount === 0 };
}
