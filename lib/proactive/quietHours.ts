/**
 * Pure quiet-hours check, reusing user_preferences.quiet_hours_start/end
 * (HH:mm, already stored — see types/reminder.ts#UserPreferences) which is
 * NOT currently enforced anywhere else in the codebase (grepped: only
 * read/written by lib/db, never checked by dueScan). V8 is the first thing
 * to actually honor it, and does so only for proactive alerts — it
 * deliberately does not touch the existing reminder/follow-up engine.
 */
export function isWithinQuietHours(
  now: Date,
  quietHoursStart: string | null,
  quietHoursEnd: string | null
): boolean {
  if (!quietHoursStart || !quietHoursEnd) return false;
  const [startH, startM] = quietHoursStart.split(":").map(Number);
  const [endH, endM] = quietHoursEnd.split(":").map(Number);
  if ([startH, startM, endH, endM].some((n) => Number.isNaN(n))) return false;

  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const startMinutes = startH * 60 + startM;
  const endMinutes = endH * 60 + endM;

  if (startMinutes === endMinutes) return false; // zero-width window = no quiet hours
  if (startMinutes < endMinutes) {
    // Same-day window, e.g. 13:00-14:00.
    return nowMinutes >= startMinutes && nowMinutes < endMinutes;
  }
  // Overnight window, e.g. 22:00-07:00.
  return nowMinutes >= startMinutes || nowMinutes < endMinutes;
}
