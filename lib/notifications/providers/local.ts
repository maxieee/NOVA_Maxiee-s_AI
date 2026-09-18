import type { NotificationProvider, ProviderResult } from "./types";

function notConfigured(channel: string): ProviderResult {
  return {
    outcome: "not_configured",
    detail: `${channel} is not configured. Requires provider setup.`,
  };
}

/**
 * The default "unconfigured" provider. Used for any channel that has no
 * real provider wired up (push/email always land here in this build; sms
 * and call fall back here too when Twilio env vars are absent). It never
 * claims success it did not achieve.
 */
export const localProvider: NotificationProvider = {
  async sendPush() {
    return notConfigured("Push notifications");
  },
  async sendSms() {
    return notConfigured("SMS");
  },
  async sendEmail() {
    return notConfigured("Email");
  },
  async placeCall() {
    return notConfigured("Phone calling");
  },
};
