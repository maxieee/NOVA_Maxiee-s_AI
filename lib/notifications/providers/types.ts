/**
 * Common provider interface for actually delivering a notification.
 *
 * Every implementation must return an honest outcome — a channel with no
 * configured provider returns "not_configured", never "sent". Nothing in
 * this codebase is allowed to fabricate delivery success.
 */
export type ProviderOutcome = "sent" | "failed" | "not_configured";

export interface ProviderResult {
  outcome: ProviderOutcome;
  detail: string;
}

export interface NotificationProvider {
  sendPush(to: string, message: string): Promise<ProviderResult>;
  sendSms(to: string, message: string): Promise<ProviderResult>;
  sendEmail(to: string, subject: string, message: string): Promise<ProviderResult>;
  placeCall(to: string, message: string): Promise<ProviderResult>;
}
