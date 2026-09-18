import webpush from "web-push";
import { db } from "@/lib/db";
import type { NotificationProvider, ProviderResult } from "./types";
import { localProvider } from "./local";
import type { PushNotificationPayload } from "@/lib/notifications/payload";

/**
 * Real Web Push provider, backed by the `web-push` package. Only attempts a
 * real send when all three VAPID env vars are present — otherwise it
 * defers to the local "not configured" provider, matching the pattern
 * twilio.ts uses for sms/call. Never fabricates a "sent" outcome.
 */
function vapidDetails() {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT;
  if (!publicKey || !privateKey || !subject) return null;
  return { publicKey, privateKey, subject };
}

export function isWebPushConfigured(): boolean {
  return vapidDetails() !== null;
}

export interface SubscriptionOutcome {
  endpoint: string;
  result: ProviderResult;
}

/**
 * Sends a push payload to every active subscription for a user, deactivating
 * any subscription the push service reports as gone (404/410). Returns one
 * ProviderResult per subscription so callers can log/report honestly.
 */
export async function sendPushToUser(
  userId: string,
  payloadOrMessage: PushNotificationPayload | string
): Promise<SubscriptionOutcome[]> {
  const details = vapidDetails();
  const subscriptions = db.listActivePushSubscriptions(userId);

  if (!details) {
    return subscriptions.map((s) => ({
      endpoint: s.endpoint,
      result: { outcome: "not_configured", detail: "Push notifications are not configured. Requires VAPID keys." },
    }));
  }

  if (subscriptions.length === 0) {
    return [];
  }

  webpush.setVapidDetails(details.subject, details.publicKey, details.privateKey);

  // A plain string is sent as-is (callers that already built a full JSON
  // PushNotificationPayload pass it stringified; a bare message string gets
  // a minimal wrapper so the service worker still has something to show).
  const body =
    typeof payloadOrMessage === "string"
      ? payloadOrMessage.trim().startsWith("{")
        ? payloadOrMessage
        : JSON.stringify({ title: "NOVA", body: payloadOrMessage, data: {}, actions: [] })
      : JSON.stringify(payloadOrMessage);

  const results: SubscriptionOutcome[] = [];
  for (const sub of subscriptions) {
    try {
      await webpush.sendNotification(
        {
          endpoint: sub.endpoint,
          keys: { p256dh: sub.p256dh, auth: sub.auth },
        },
        body
      );
      results.push({ endpoint: sub.endpoint, result: { outcome: "sent", detail: "Push delivered to browser push service." } });
    } catch (err: unknown) {
      const statusCode = (err as { statusCode?: number })?.statusCode;
      if (statusCode === 404 || statusCode === 410) {
        db.deactivatePushSubscription(sub.endpoint);
        results.push({
          endpoint: sub.endpoint,
          result: { outcome: "failed", detail: "Subscription expired/invalid; deactivated." },
        });
      } else {
        db.recordPushFailure(sub.endpoint);
        const message = err instanceof Error ? err.message : String(err);
        results.push({ endpoint: sub.endpoint, result: { outcome: "failed", detail: `Push send failed: ${message}` } });
      }
    }
  }
  return results;
}

/** Aggregates per-subscription outcomes into one ProviderResult for the NotificationProvider interface. */
function aggregate(results: SubscriptionOutcome[]): ProviderResult {
  if (results.length === 0) {
    return { outcome: "not_configured", detail: "No active push subscriptions for this user." };
  }
  if (results.some((r) => r.result.outcome === "sent")) {
    const sent = results.filter((r) => r.result.outcome === "sent").length;
    return { outcome: "sent", detail: `Delivered to ${sent}/${results.length} subscription(s).` };
  }
  if (results.every((r) => r.result.outcome === "not_configured")) {
    return { outcome: "not_configured", detail: results[0].result.detail };
  }
  return { outcome: "failed", detail: results[0].result.detail };
}

export const webpushProvider: NotificationProvider = {
  async sendPush(to: string, message: string) {
    const results = await sendPushToUser(to, message);
    return aggregate(results);
  },
  sendSms: localProvider.sendSms,
  sendEmail: localProvider.sendEmail,
  placeCall: localProvider.placeCall,
};
