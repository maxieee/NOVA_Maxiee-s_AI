import type { NotificationProvider } from "./types";
import { localProvider } from "./local";
import { twilioProvider, isTwilioConfigured } from "./twilio";

export type { NotificationProvider, ProviderResult, ProviderOutcome } from "./types";
export { localProvider } from "./local";
export { twilioProvider, isTwilioConfigured } from "./twilio";

/**
 * Single entry point: returns the Twilio-backed provider for call/sms when
 * its env vars are all present, otherwise the local "not configured"
 * provider. Push and email have no provider in this build regardless.
 */
export function getNotificationProvider(): NotificationProvider {
  return isTwilioConfigured() ? twilioProvider : localProvider;
}
