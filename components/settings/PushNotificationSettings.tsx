"use client";

import { useState } from "react";
import { usePushNotifications } from "@/hooks/usePushNotifications";

const STATUS_COPY: Record<string, { label: string; enabled: boolean; reason: string }> = {
  unsupported: { label: "Not enabled", enabled: false, reason: "This browser does not support push notifications." },
  checking: { label: "Checking…", enabled: false, reason: "" },
  default: { label: "Not enabled", enabled: false, reason: "Notification permission has not been requested yet." },
  denied: { label: "Not enabled", enabled: false, reason: "Notification permission was denied in the browser." },
  "granted-not-subscribed": {
    label: "Not enabled",
    enabled: false,
    reason: "Permission granted, but there's no active subscription yet.",
  },
  subscribed: { label: "Enabled", enabled: true, reason: "Active subscription found for this browser." },
};

export function PushNotificationSettings() {
  const { status, error, busy, subscribe, unsubscribe, sendTest } = usePushNotifications();
  const [testResult, setTestResult] = useState<{ ok: boolean; detail: string } | null>(null);
  const copy = STATUS_COPY[status] ?? STATUS_COPY.default;

  return (
    <div className="nova-card p-5">
      <h3 className="mb-4 text-sm font-semibold text-white">Push Notifications</h3>

      <div className="mb-4 flex items-center gap-2 text-sm">
        <span className={copy.enabled ? "text-nova-good" : "text-nova-muted"}>
          {copy.enabled ? "●" : "○"} {copy.label}
        </span>
      </div>
      {copy.reason && <p className="mb-4 text-xs text-nova-muted">{copy.reason}</p>}
      {error && <p className="mb-4 text-xs text-nova-primary">{error}</p>}

      <div className="flex flex-wrap gap-2">
        {status !== "subscribed" && status !== "unsupported" && (
          <button
            type="button"
            disabled={busy}
            onClick={() => subscribe()}
            className="rounded-xl bg-nova-accent px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            Enable Notifications
          </button>
        )}

        {status === "subscribed" && (
          <>
            <button
              type="button"
              disabled={busy}
              onClick={() => unsubscribe()}
              className="rounded-xl border border-nova-border px-4 py-2 text-sm font-medium text-white transition-colors hover:border-nova-accent disabled:opacity-50"
            >
              Disable in NOVA
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={async () => setTestResult(await sendTest())}
              className="rounded-xl bg-nova-primary px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              Send Test Notification
            </button>
          </>
        )}
      </div>

      {testResult && (
        <p className={`mt-3 text-xs ${testResult.ok ? "text-nova-good" : "text-nova-primary"}`}>
          {testResult.detail}
        </p>
      )}

      {status === "denied" && (
        <p className="mt-3 text-xs text-nova-muted">
          To re-enable, allow notifications for this site in your browser&apos;s site settings — NOVA
          cannot override an OS/browser-level denial from inside the app.
        </p>
      )}
    </div>
  );
}
