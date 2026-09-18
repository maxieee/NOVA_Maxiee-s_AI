"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AUTOMATION_TEMPLATES } from "@/lib/automation/templates";
import type { AutomationRecord, AutomationRunRecord } from "@/types/reminder";

const OUTCOME_LABEL: Record<string, string> = {
  success: "Ran",
  failed: "Failed",
  skipped_condition: "Skipped (condition)",
  skipped_cooldown: "Skipped (already ran)",
};

const TRIGGER_LABEL: Record<string, string> = {
  reminder_completed: "When a reminder is completed",
  payment_overdue: "When a payment is overdue",
  cron_daily: "Every day",
  cron_weekly: "Every week",
};

function AutomationRow({ automation }: { automation: AutomationRecord }) {
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);
  const [runs, setRuns] = useState<AutomationRunRecord[] | null>(null);
  const [busy, setBusy] = useState(false);

  async function toggleEnabled() {
    setBusy(true);
    await fetch(`/api/automations/${automation.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: !automation.enabled }),
    });
    setBusy(false);
    router.refresh();
  }

  async function remove() {
    if (!confirm(`Delete automation "${automation.name}"? This cannot be undone.`)) return;
    setBusy(true);
    await fetch(`/api/automations/${automation.id}`, { method: "DELETE" });
    setBusy(false);
    router.refresh();
  }

  async function toggleHistory() {
    if (!expanded && !runs) {
      const res = await fetch(`/api/automations/${automation.id}/runs`);
      const data = await res.json();
      setRuns(data.runs);
    }
    setExpanded((v) => !v);
  }

  return (
    <li className="rounded-xl border border-nova-border p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-white">{automation.name}</p>
          <p className="mt-0.5 text-xs text-nova-muted">
            {TRIGGER_LABEL[automation.trigger_type] ?? automation.trigger_type} · {automation.action_type}
          </p>
          {automation.last_run_at && (
            <p className="mt-0.5 text-xs text-nova-muted">
              Last ran {new Date(automation.last_run_at).toLocaleString()}
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={toggleEnabled}
            disabled={busy}
            className={`rounded-full px-3 py-1 text-xs font-medium ${
              automation.enabled ? "bg-nova-good/20 text-nova-good" : "bg-nova-surface2 text-nova-muted"
            }`}
          >
            {automation.enabled ? "Enabled" : "Disabled"}
          </button>
          <button
            type="button"
            onClick={remove}
            disabled={busy}
            className="rounded-full bg-nova-urgent/10 px-3 py-1 text-xs font-medium text-nova-urgent"
          >
            Delete
          </button>
        </div>
      </div>
      <button type="button" onClick={toggleHistory} className="mt-3 text-xs text-nova-accent">
        {expanded ? "Hide history" : "View run history"}
      </button>
      {expanded && (
        <ul className="mt-2 space-y-1.5 border-t border-nova-border pt-2">
          {runs && runs.length === 0 && <li className="text-xs text-nova-muted">No runs yet.</li>}
          {runs?.map((run) => (
            <li key={run.id} className="flex items-center justify-between text-xs">
              <span className="text-nova-muted">{new Date(run.triggered_at).toLocaleString()}</span>
              <span
                className={
                  run.outcome === "success"
                    ? "text-nova-good"
                    : run.outcome === "failed"
                      ? "text-nova-urgent"
                      : "text-nova-muted"
                }
              >
                {OUTCOME_LABEL[run.outcome] ?? run.outcome}
              </span>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

export function AutomationsManager({ initialAutomations }: { initialAutomations: AutomationRecord[] }) {
  const router = useRouter();
  const [creating, setCreating] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});

  async function createFromTemplate(templateId: string) {
    await fetch("/api/automations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ templateId, values }),
    });
    setCreating(null);
    setValues({});
    router.refresh();
  }

  return (
    <div className="space-y-6">
      <div className="nova-card p-5">
        <h3 className="mb-3 text-sm font-semibold text-white">Add an automation</h3>
        <div className="grid gap-3 md:grid-cols-3">
          {AUTOMATION_TEMPLATES.map((template) => (
            <div key={template.id} className="rounded-xl border border-nova-border p-3">
              <p className="text-sm text-white">{template.label}</p>
              <p className="mt-1 text-xs text-nova-muted">{template.description}</p>
              {creating === template.id ? (
                <div className="mt-3 space-y-2">
                  {template.fields.map((field) => (
                    <input
                      key={field.key}
                      type={field.type}
                      placeholder={field.placeholder}
                      value={values[field.key] ?? ""}
                      onChange={(e) => setValues((v) => ({ ...v, [field.key]: e.target.value }))}
                      className="w-full rounded-lg border border-nova-border bg-nova-surface2 px-2 py-1 text-xs text-white"
                    />
                  ))}
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => createFromTemplate(template.id)}
                      className="rounded-full bg-nova-primary/20 px-3 py-1 text-xs font-medium text-nova-primary"
                    >
                      Create
                    </button>
                    <button
                      type="button"
                      onClick={() => setCreating(null)}
                      className="rounded-full bg-nova-surface2 px-3 py-1 text-xs text-nova-muted"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setCreating(template.id)}
                  className="mt-3 rounded-full bg-nova-surface2 px-3 py-1 text-xs font-medium text-white"
                >
                  Use this template
                </button>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="nova-card p-5">
        <h3 className="mb-3 text-sm font-semibold text-white">Your automations</h3>
        {initialAutomations.length === 0 ? (
          <p className="text-sm text-nova-muted">No automations yet — add one above.</p>
        ) : (
          <ul className="space-y-3">
            {initialAutomations.map((a) => (
              <AutomationRow key={a.id} automation={a} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
