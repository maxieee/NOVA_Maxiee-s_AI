"use client";

import { useEffect, useState } from "react";

interface IntegrationStatus {
  provider: string;
  name: string;
  configured: boolean;
  status: "not_connected" | "connected" | "error" | "expired";
  connectedAt: string | null;
  lastError: string | null;
}

const STATUS_LABEL: Record<string, string> = {
  not_connected: "Not connected",
  connected: "Connected",
  error: "Connection error",
  expired: "Expired — reconnect",
};

const STATUS_COLOR: Record<string, string> = {
  not_connected: "text-nova-muted",
  connected: "text-nova-good",
  error: "text-nova-urgent",
  expired: "text-nova-warn",
};

/**
 * V11 — Integrations. Honestly renders "Not connected — requires
 * GOOGLE_CLIENT_ID/SECRET" whenever the connector isn't configured, the
 * same honesty pattern as the existing Twilio/Web Push "not configured"
 * card. No integration in this build is ever shown as connected unless a
 * real OAuth token exchange actually succeeded.
 */
export function IntegrationsSettings() {
  const [integrations, setIntegrations] = useState<IntegrationStatus[] | null>(null);

  useEffect(() => {
    fetch("/api/integrations")
      .then((r) => r.json())
      .then((data) => setIntegrations(data.integrations))
      .catch(() => setIntegrations([]));
  }, []);

  return (
    <div className="nova-card p-5">
      <h3 className="mb-1 text-sm font-semibold text-white">Integrations</h3>
      <p className="mb-4 text-xs text-nova-muted">
        External connectors are architecture-only in this build unless real provider credentials
        are configured — NOVA never claims a connection that hasn&apos;t actually succeeded.
      </p>

      {!integrations ? (
        <p className="text-sm text-nova-muted">Loading…</p>
      ) : (
        <ul className="space-y-3">
          {integrations.map((integration) => (
            <li
              key={integration.provider}
              className="flex items-center justify-between rounded-xl border border-nova-border px-3 py-3"
            >
              <div>
                <p className="text-sm text-white">{integration.name}</p>
                <p className={`mt-0.5 text-xs ${STATUS_COLOR[integration.status]}`}>
                  {STATUS_LABEL[integration.status]}
                  {!integration.configured && " — requires GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET/GOOGLE_REDIRECT_URI"}
                </p>
                {integration.lastError && (
                  <p className="mt-0.5 text-xs text-nova-urgent">{integration.lastError}</p>
                )}
              </div>
              {integration.configured && integration.status !== "connected" && (
                <a
                  href="/api/integrations/google/connect"
                  className="shrink-0 rounded-full bg-nova-primary/20 px-4 py-1.5 text-xs font-medium text-nova-primary"
                >
                  Connect
                </a>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
