/**
 * lib/copy.ts — everywhere NOVA "speaks".
 *
 * Small, centralized microcopy module so the assistant's voice stays
 * consistent and easy to audit/change in one place, instead of scattering
 * literal strings across pages and components.
 */

export function greeting(name: string): string {
  const hour = new Date().getHours();
  const part = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  return `${part}, ${name}.`;
}

export function todayStatLine(total: number): string {
  if (total === 0) return "Nothing on your plate right now.";
  if (total === 1) return "You have 1 thing to handle today.";
  return `You have ${total} things to handle today.`;
}

export const OVERDUE_HEADLINE = "Needs Attention";
export const OVERDUE_SUBLINE = "These still need your attention.";

export const NOTHING_URGENT = "Nothing urgent right now. Nice work.";

export const UPCOMING_HEADLINE = "Upcoming";
export const UPCOMING_EMPTY = "Nothing scheduled beyond today.";

export const COMPLETED_HEADLINE = "Completed";
export const COMPLETED_EMPTY = "Nothing wrapped up yet today.";

export const DONE_CONFIRMATION = "Done. I've got it.";
export const SNOOZE_CONFIRMATION = "Snoozed — I'll bring it back up.";

export function notConfigured(channel: string): string {
  return `${channel} is not configured. Requires provider setup.`;
}
