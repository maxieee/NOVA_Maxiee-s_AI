"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/ui/Icon";
import { DONE_CONFIRMATION, SNOOZE_CONFIRMATION } from "@/lib/copy";

export function ReminderActions({ reminderId, compact }: { reminderId: string; compact?: boolean }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [showSnooze, setShowSnooze] = useState(false);
  const [confirmation, setConfirmation] = useState<string | null>(null);

  async function call(path: string, body?: object) {
    await fetch(`/api/reminders/${reminderId}/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    setConfirmation(path === "done" ? DONE_CONFIRMATION : SNOOZE_CONFIRMATION);
    window.setTimeout(() => setConfirmation(null), 2500);
    startTransition(() => router.refresh());
  }

  function stop(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
  }

  return (
    <div
      className="relative flex items-center gap-2"
      onClick={stop}
    >
      <button
        onClick={(e) => {
          stop(e);
          call("done");
        }}
        disabled={isPending}
        className={`nova-btn-primary ${compact ? "px-3 py-1.5 text-xs" : ""}`}
      >
        <Icon name="check" className="h-3.5 w-3.5" />
        Done
      </button>
      <button
        onClick={(e) => {
          stop(e);
          setShowSnooze((s) => !s);
        }}
        disabled={isPending}
        className={`nova-btn-secondary ${compact ? "px-3 py-1.5 text-xs" : ""}`}
      >
        <Icon name="alarm-clock" className="h-3.5 w-3.5" />
        Snooze
      </button>
      <button
        onClick={(e) => {
          stop(e);
          call("snooze", { minutes: 5 });
        }}
        disabled={isPending}
        className={`nova-btn-secondary ${compact ? "px-3 py-1.5 text-xs" : ""}`}
        title="Remind again shortly"
      >
        <Icon name="refresh-cw" className="h-3.5 w-3.5" />
        Remind Again
      </button>

      {showSnooze && (
        <div className="absolute right-0 top-full z-10 mt-2 flex flex-col gap-1 rounded-xl border border-nova-border bg-nova-surface2 p-1.5 shadow-xl animate-fade-in">
          {[
            { label: "15 min", minutes: 15 },
            { label: "1 hour", minutes: 60 },
            { label: "Tomorrow", minutes: 60 * 24 },
          ].map((opt) => (
            <button
              key={opt.label}
              onClick={(e) => {
                stop(e);
                setShowSnooze(false);
                call("snooze", { minutes: opt.minutes });
              }}
              className="whitespace-nowrap rounded-lg px-3 py-1.5 text-left text-xs text-white hover:bg-nova-surface"
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}

      {confirmation && (
        <span className="absolute -top-6 left-0 whitespace-nowrap text-[11px] font-medium text-nova-accent animate-fade-in">
          {confirmation}
        </span>
      )}
    </div>
  );
}
