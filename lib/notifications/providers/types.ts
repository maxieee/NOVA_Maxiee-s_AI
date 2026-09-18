/**
 * Common provider interface for actually delivering a notification.
 *
 * Every implementation must return an honest outcome — a channel with no
 * configured provider returns "not_configured", never "sent". Nothing in
 * this codebase is allowed to fabricate delivery success.
 */
export type ProviderOutcome = "sent" | "failed" | "not_configured" | "invalid_number";

export interface ProviderResult {
  outcome: ProviderOutcome;
  detail: string;
  /** Provider-side reference for a genuinely sent notification (e.g. a Twilio Call SID). Never a credential. */
  providerRef?: string;
}

export interface NotificationProvider {
  sendPush(to: string, message: string): Promise<ProviderResult>;
  sendSms(to: string, message: string): Promise<ProviderResult>;
  sendEmail(to: string, subject: string, message: string): Promise<ProviderResult>;
  placeCall(to: string, message: string): Promise<ProviderResult>;
}
