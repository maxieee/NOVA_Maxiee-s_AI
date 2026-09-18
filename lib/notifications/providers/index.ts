import type { NotificationProvider } from "./types";
import { localProvider } from "./local";
import { twilioProvider, isTwilioConfigured } from "./twilio";
import { webpushProvider, isWebPushConfigured } from "./webpush";

export type { NotificationProvider, ProviderResult, ProviderOutcome } from "./types";
export { localProvider } from "./local";
export { twilioProvider, isTwilioConfigured } from "./twilio";
export { webpushProvider, isWebPushConfigured, sendPushToUser } from "./webpush";

/**
 * Single entry point: composes the real providers for each channel when
 * configured, otherwise falls back to the local "not configured" provider.
 * Push -> webpush (VAPID keys), SMS/call -> Twilio, email -> none in this
 * build. Nothing here ever fabricates a "sent" outcome.
 */
export function getNotificationProvider(): NotificationProvider {
  const push = isWebPushConfigured() ? webpushProvider : localProvider;
  const smsCall = isTwilioConfigured() ? twilioProvider : localProvider;
  return {
    sendPush: push.sendPush,
    sendSms: smsCall.sendSms,
    placeCall: smsCall.placeCall,
    sendEmail: localProvider.sendEmail,
  };
}
