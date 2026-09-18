import type { IntegrationProvider } from "@/types/reminder";

/**
 * V11 — Integration architecture.
 *
 * Design note: this interface is deliberately shaped around what a real
 * Google Calendar OAuth2 (authorization-code flow) + Calendar API v3
 * (read-only) integration actually needs, so a future provider can drop
 * in beside googleCalendar.ts without changing this contract. None of the
 * connectors in this codebase are exercised end-to-end in this sandbox
 * (no real Google Cloud project, no browser to complete consent) — every
 * connector MUST honestly report isConfigured() === false when its real
 * env vars are absent, exactly like lib/notifications/providers/twilio.ts
 * reports "not_configured" without real Twilio credentials.
 */
export interface TokenResult {
  outcome: "connected" | "failed" | "not_configured";
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: string; // ISO datetime
  detail?: string;
}

export interface NormalizedEvent {
  id: string;
  title: string;
  start: string; // ISO datetime
  end: string | null; // ISO datetime
  source: IntegrationProvider;
}

export interface IntegrationConnector {
  id: IntegrationProvider;
  name: string;
  /** True only when this provider's real credentials are present in env. */
  isConfigured(): boolean;
  /** Real, standard OAuth2 authorization-code-flow consent URL. */
  getAuthUrl?(state: string): string;
  /** Real token exchange against the provider's documented token endpoint. */
  exchangeCode?(code: string): Promise<TokenResult>;
  /** Real read-only event fetch, once connected. Never called unless a
   * real access token exists — never fabricates events. */
  fetchEvents?(accessToken: string): Promise<NormalizedEvent[]>;
}
