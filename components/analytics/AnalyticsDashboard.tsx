"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { StatTile } from "@/components/dashboard/StatTile";
import type { AnalyticsReport } from "@/lib/analytics/report";

const SEVERITY_TONE: Record<string, string> = {
  info: "text-nova-accent",
  notice: "text-nova-warn",
  warning: "text-nova-urgent",
};

function Bar({ label, value, max, tone = "bg-nova-accent" }: { label: string; value: number; max: number; tone?: string }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div className="flex items-center gap-3 text-xs">
      <span className="w-28 shrink-0 truncate text-nova-muted">{label}</span>
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-nova-surface2">
        <div className={`h-full rounded-full ${tone}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="w-8 shrink-0 text-right text-nova-muted">{value}</span>
    </div>
  );
}

export function AnalyticsDashboard({ report }: { report: AnalyticsReport }) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);

  async function act(id: string, action: "apply" | "dismiss") {
    setBusyId(id);
    await fetch(`/api/analytics/recommendations/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    setBusyId(null);
    router.refresh();
  }

  const { completion, snooze, notifications, paymentTiming, proactiveActivity, automationActivity, insights, recommendations } =
    report;

  const notificationOutcomeEntries = Object.entries(notifications.byChannel);
  const proactiveRuleEntries = Object.entries(proactiveActivity.byRule);
  const maxProactive = Math.max(1, ...proactiveRuleEntries.map(([, v]) => v));
  const maxAutomation = Math.max(1, ...automationActivity.byAutomation.map((a) => a.runs));

  return (
    <div className="space-y-6">
      {/* Top-line stats — only genuinely meaningful numbers, no vanity metrics */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile label="Created" value={completion.createdCount} icon="bell" tone="accent" />
        <StatTile label="Completed" value={completion.completedCount} icon="check-square" tone="good" />
        <StatTile label="Overdue now" value={completion.overdueCount} icon="alarm-clock" tone="urgent" />
        <StatTile label="Snoozes" value={snooze.totalSnoozes} icon="repeat" tone="warn" />
      </div>

      {completion.completionRate !== null && (
        <div className="nova-card p-5">
          <h3 className="mb-3 text-sm font-semibold text-white">Completion rate</h3>
          <Bar label="Completed" value={completion.completedCount} max={completion.createdCount} tone="bg-nova-good" />
          {completion.avgTimeToCompletionHours !== null && (
            <p className="mt-3 text-xs text-nova-muted">
              Average time to completion:{" "}
              {completion.avgTimeToCompletionHours < 24
                ? `${completion.avgTimeToCompletionHours.toFixed(1)} hours`
                : `${(completion.avgTimeToCompletionHours / 24).toFixed(1)} days`}
            </p>
          )}
        </div>
      )}

      {snooze.perReminder.length > 0 && (
        <div className="nova-card p-5">
          <h3 className="mb-3 text-sm font-semibold text-white">Snooze patterns</h3>
          <div className="space-y-2">
            {snooze.perReminder.slice(0, 6).map((p) => (
              <Bar
                key={p.reminderId}
                label={p.title}
                value={p.snoozeCount}
                max={Math.max(...snooze.perReminder.map((x) => x.snoozeCount))}
                tone="bg-nova-warn"
              />
            ))}
          </div>
        </div>
      )}

      {notificationOutcomeEntries.length > 0 && (
        <div className="nova-card p-5">
          <h3 className="mb-3 text-sm font-semibold text-white">Notification delivery by channel</h3>
          <div className="space-y-3">
            {notificationOutcomeEntries.map(([channel, outcomes]) => {
              const total = outcomes.sent + outcomes.failed + outcomes.not_configured + outcomes.invalid_number;
              return (
                <div key={channel}>
                  <p className="mb-1 text-xs font-medium text-white capitalize">{channel}</p>
                  <Bar label="Sent" value={outcomes.sent} max={total} tone="bg-nova-good" />
                  <Bar label="Failed" value={outcomes.failed} max={total} tone="bg-nova-urgent" />
                  <Bar label="Not configured" value={outcomes.not_configured} max={total} tone="bg-nova-muted" />
                </div>
              );
            })}
          </div>
        </div>
      )}

      {paymentTiming.avgDaysFromFirstNotificationToPaid !== null && (
        <div className="nova-card p-5">
          <h3 className="mb-1 text-sm font-semibold text-white">Payment behavior</h3>
          <p className="text-xs text-nova-muted">
            Across {paymentTiming.sampleSize} paid cycles, you typically paid about{" "}
            {paymentTiming.avgDaysFromFirstNotificationToPaid.toFixed(1)} days after the first reminder.
          </p>
        </div>
      )}

      {(proactiveRuleEntries.length > 0 || automationActivity.totalRuns > 0) && (
        <div className="grid gap-4 md:grid-cols-2">
          {proactiveRuleEntries.length > 0 && (
            <div className="nova-card p-5">
              <h3 className="mb-3 text-sm font-semibold text-white">Proactive intelligence activity</h3>
              <div className="space-y-2">
                {proactiveRuleEntries.map(([rule, count]) => (
                  <Bar key={rule} label={rule} value={count} max={maxProactive} tone="bg-nova-accent" />
                ))}
              </div>
            </div>
          )}
          {automationActivity.byAutomation.length > 0 && (
            <div className="nova-card p-5">
              <h3 className="mb-3 text-sm font-semibold text-white">Automation activity</h3>
              <div className="space-y-2">
                {automationActivity.byAutomation.map((a) => (
                  <Bar key={a.automationId} label={a.name} value={a.runs} max={maxAutomation} tone="bg-nova-good" />
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <div className="nova-card p-5">
        <h3 className="mb-3 text-sm font-semibold text-white">Insights</h3>
        {insights.length === 0 ? (
          <p className="text-sm text-nova-muted">
            Not enough activity yet for a reliable observation — insights need a real, minimum sample size before
            NOVA will surface them.
          </p>
        ) : (
          <ul className="space-y-2">
            {insights.map((insight) => (
              <li key={insight.id} className="rounded-lg border border-nova-border p-3 text-sm">
                <span className={`mr-2 text-xs font-semibold uppercase ${SEVERITY_TONE[insight.severity]}`}>
                  {insight.category}
                </span>
                <span className="text-nova-text">{insight.message}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="nova-card p-5">
        <h3 className="mb-3 text-sm font-semibold text-white">Recommendations</h3>
        {recommendations.length === 0 ? (
          <p className="text-sm text-nova-muted">No pending recommendations right now.</p>
        ) : (
          <ul className="space-y-3">
            {recommendations.map((rec) => (
              <li key={rec.id} className="rounded-lg border border-nova-border p-3">
                <p className="text-sm font-medium text-white">{rec.title}</p>
                <p className="mt-1 text-xs text-nova-muted">{rec.message}</p>
                <div className="mt-3 flex gap-2">
                  <button
                    type="button"
                    disabled={busyId === rec.id}
                    onClick={() => act(rec.id, "apply")}
                    className="rounded-full bg-nova-good/20 px-3 py-1 text-xs font-medium text-nova-good"
                  >
                    Apply
                  </button>
                  <button
                    type="button"
                    disabled={busyId === rec.id}
                    onClick={() => act(rec.id, "dismiss")}
                    className="rounded-full bg-nova-surface2 px-3 py-1 text-xs font-medium text-nova-muted"
                  >
                    Dismiss
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
