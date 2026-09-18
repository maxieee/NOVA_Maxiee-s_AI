import type { NotificationChannel, ReminderIntensity } from "@/types/reminder";

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
}

/** Minutes between repeats, before escalation, per intensity level. */
export const INTENSITY_REPEAT_MINUTES: Record<ReminderIntensity, number> = {
  gentle: 240,
  normal: 120,
  persistent: 30,
  critical: 10,
};

/**
 * How many unacknowledged repeats happen before NOVA escalates to a call
 * (if the person asked for calls and one is configured). "gentle" never
 * escalates on its own.
 */
export const ESCALATE_AFTER_REPEATS: Record<ReminderIntensity, number> = {
  gentle: Infinity,
  normal: 3,
  persistent: 2,
  critical: 1,
};

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

  const shouldEscalate = input.repeatCount + 1 >= ESCALATE_AFTER_REPEATS[input.intensity];

  if (shouldEscalate && available.includes("call")) {
    return { type: "notify", channel: "call", escalated: true };
  }

  const next = CHANNEL_PRIORITY.find((c) => available.includes(c)) ?? available[0];
  return { type: "notify", channel: next, escalated: shouldEscalate };
}
