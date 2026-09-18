import type { FollowUpState } from "@/types/reminder";

const LABEL: Partial<Record<FollowUpState, string>> = {
  notified: "Notified",
  follow_up_sent: "Follow-up sent",
  escalated: "Escalated",
  waiting: "Waiting for you",
};

const ICON: Partial<Record<FollowUpState, string>> = {
  notified: "\u{1F514}", // 🔔
  follow_up_sent: "\u{1F514}", // 🔔
  escalated: "\u{1F6A8}", // 🚨
  waiting: "⏳", // ⏳
};

const TONE: Partial<Record<FollowUpState, string>> = {
  notified: "text-nova-muted",
  follow_up_sent: "text-nova-accent",
  escalated: "text-nova-urgent",
  waiting: "text-nova-muted",
};

function minutesAgo(iso: string, now: Date): number {
  return Math.max(0, Math.round((now.getTime() - new Date(iso).getTime()) / 60_000));
}

/**
 * Small, non-intrusive follow-up status chip for a reminder card — derived
 * from the real occurrence's follow_up_state / last_notified_at, never
 * fabricated client-side.
 */
export function FollowUpBadge({
  state,
  lastNotifiedAt,
  now,
}: {
  state?: FollowUpState | null;
  lastNotifiedAt?: string | null;
  now?: Date;
}) {
  if (!state || !LABEL[state]) return null;
  const label = LABEL[state]!;
  const suffix = lastNotifiedAt ? ` ${minutesAgo(lastNotifiedAt, now ?? new Date())}m ago` : "";

  return (
    <span className={`inline-flex items-center gap-1 text-[11px] font-medium ${TONE[state]}`}>
      <span aria-hidden>{ICON[state]}</span>
      {label}
      {state !== "waiting" && suffix}
    </span>
  );
}
