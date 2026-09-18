"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ProactiveNotificationRecord } from "@/types/reminder";

const PRIORITY_COLOR: Record<string, string> = {
  urgent: "text-nova-urgent",
  high: "text-nova-warn",
  medium: "text-nova-accent",
  low: "text-nova-muted",
};

const OUTCOME_LABEL: Record<string, string> = {
  sent: "Sent",
  failed: "Failed",
  not_configured: "Not configured",
  invalid_number: "Invalid number",
  suppressed_quiet_hours: "Held (quiet hours)",
  suppressed_cooldown: "Skipped (cooldown)",
};

export function ProactiveIntelligenceSettings({
  enabled,
  history,
}: {
  enabled: boolean;
  history: ProactiveNotificationRecord[];
}) {
  const router = useRouter();
  const [checked, setChecked] = useState(enabled);
  const [saving, setSaving] = useState(false);

  async function toggle() {
    const next = !checked;
    setChecked(next);
    setSaving(true);
    await fetch("/api/preferences", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ proactive_intelligence_enabled: next }),
    });
    setSaving(false);
    router.refresh();
  }

  return (
    <div className="nova-card p-5">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-white">Proactive Intelligence</h3>
          <p className="mt-1 text-xs text-nova-muted">
            NOVA watches for payments piling up, ignored reminders and missed recurring items, and
            proactively says something — with anti-spam cooldowns and your quiet hours respected.
          </p>
        </div>
        <button
          type="button"
          onClick={toggle}
          disabled={saving}
          aria-pressed={checked}
          className={`shrink-0 rounded-full px-4 py-1.5 text-xs font-medium transition-colors ${
            checked
              ? "bg-nova-good/20 text-nova-good"
              : "bg-nova-surface2 text-nova-muted"
          }`}
        >
          {checked ? "On" : "Off"}
        </button>
      </div>

      <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-nova-muted">
        Recent activity
      </h4>
      {history.length === 0 ? (
        <p className="text-sm text-nova-muted">No proactive alerts yet.</p>
      ) : (
        <ul className="space-y-2">
          {history.slice(0, 10).map((entry) => (
            <li
              key={entry.id}
              className="flex items-start justify-between gap-3 rounded-xl border border-nova-border px-3 py-2 text-sm"
            >
              <div>
                <p className="text-white">{entry.message}</p>
                <p className="mt-0.5 text-xs text-nova-muted">
                  {entry.rule_id} · {new Date(entry.fired_at).toLocaleString()}
                </p>
              </div>
              <div className="shrink-0 text-right text-xs">
                <p className={PRIORITY_COLOR[entry.priority] ?? "text-nova-muted"}>{entry.priority}</p>
                <p className="text-nova-muted">{OUTCOME_LABEL[entry.outcome] ?? entry.outcome}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
