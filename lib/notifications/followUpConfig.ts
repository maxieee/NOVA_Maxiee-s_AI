import type { ReminderIntensity } from "@/types/reminder";

/**
 * Centralized, env-overridable follow-up/escalation timing.
 *
 * Nothing in the escalation/scan code should hardcode a minute count or a
 * repeat threshold — everything reads from here so a developer can drop
 * these to a few minutes (or seconds via *_SECONDS overrides) locally
 * without touching logic, while production keeps the longer defaults.
 *
 * Precedence per intensity: NOVA_FOLLOWUP_MINUTES_<INTENSITY> (or the
 * *_SECONDS variant, handy for fast local iteration) overrides the
 * built-in default; otherwise the default is used untouched. This keeps
 * existing tests (which run with no env overrides set) exercising the
 * original production numbers.
 */

function envNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** Minutes, with an optional *_SECONDS override for fast local testing. */
function envMinutes(nameMinutes: string, nameSeconds: string, fallback: number): number {
  const seconds = process.env[nameSeconds];
  if (seconds) {
    const n = Number(seconds);
    if (Number.isFinite(n) && n > 0) return n / 60;
  }
  return envNumber(nameMinutes, fallback);
}

const DEFAULT_INTERVAL_MINUTES: Record<ReminderIntensity, number> = {
  gentle: 240,
  normal: 120,
  persistent: 30,
  critical: 10,
};

/** Minutes between repeats/follow-ups, before escalation, per intensity level. */
export const FOLLOW_UP_INTERVAL_MINUTES: Record<ReminderIntensity, number> = {
  gentle: envMinutes(
    "NOVA_FOLLOWUP_MINUTES_GENTLE",
    "NOVA_FOLLOWUP_SECONDS_GENTLE",
    DEFAULT_INTERVAL_MINUTES.gentle
  ),
  normal: envMinutes(
    "NOVA_FOLLOWUP_MINUTES_NORMAL",
    "NOVA_FOLLOWUP_SECONDS_NORMAL",
    DEFAULT_INTERVAL_MINUTES.normal
  ),
  persistent: envMinutes(
    "NOVA_FOLLOWUP_MINUTES_PERSISTENT",
    "NOVA_FOLLOWUP_SECONDS_PERSISTENT",
    DEFAULT_INTERVAL_MINUTES.persistent
  ),
  critical: envMinutes(
    "NOVA_FOLLOWUP_MINUTES_CRITICAL",
    "NOVA_FOLLOWUP_SECONDS_CRITICAL",
    DEFAULT_INTERVAL_MINUTES.critical
  ),
};

/**
 * How many unacknowledged repeats happen before NOVA escalates to the next
 * channel (typically a call, if requested and configured). "gentle" is
 * "initial + one follow-up then stop/stay-overdue" — it never escalates on
 * its own.
 */
export const ESCALATE_AFTER_REPEATS: Record<ReminderIntensity, number> = {
  gentle: Infinity,
  normal: envNumber("NOVA_ESCALATE_AFTER_NORMAL", 3),
  persistent: envNumber("NOVA_ESCALATE_AFTER_PERSISTENT", 2),
  critical: envNumber("NOVA_ESCALATE_AFTER_CRITICAL", 1),
};

/**
 * "gentle" = initial notification + exactly one follow-up, then it stops
 * actively notifying (the occurrence just sits overdue until the person
 * acts). Every other intensity keeps following up per
 * ESCALATE_AFTER_REPEATS/MAX_FOLLOW_UP_ATTEMPTS.
 */
export const GENTLE_MAX_FOLLOW_UPS = 1;

/** Hard ceiling on repeat attempts for any intensity, so nothing loops forever. */
export const MAX_FOLLOW_UP_ATTEMPTS = envNumber("NOVA_MAX_FOLLOWUP_ATTEMPTS", 8);

export function maxAttemptsFor(intensity: ReminderIntensity, userMax?: number): number {
  const ceiling = userMax && userMax > 0 ? userMax : MAX_FOLLOW_UP_ATTEMPTS;
  if (intensity === "gentle") return Math.min(ceiling, GENTLE_MAX_FOLLOW_UPS + 1); // + the initial send
  return ceiling;
}

/** True only for a positive integer — rejects 0, negatives, NaN, and non-integers. */
function isValidThreshold(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

/**
 * Per-user override for ESCALATE_AFTER_REPEATS, from
 * user_preferences.escalation_threshold_repeats. Invalid/missing values
 * (0, negative, NaN, non-integer, undefined/null) fall back to the
 * existing per-intensity default untouched. "gentle" never escalates on
 * its own — a user override cannot change that, matching the existing
 * ESCALATE_AFTER_REPEATS.gentle = Infinity semantics.
 */
export function escalateAfterFor(intensity: ReminderIntensity, userThreshold?: number | null): number {
  if (intensity === "gentle") return Infinity;
  return isValidThreshold(userThreshold) ? userThreshold : ESCALATE_AFTER_REPEATS[intensity];
}
