import type { NotificationProvider, ProviderResult } from "./types";
import { localProvider } from "./local";
import { validatePhoneNumber } from "../validatePhoneNumber";
import { escapeForTwiml } from "../callScript";

/**
 * Twilio-backed provider for phone calls (and, since it's the same account,
 * SMS). Reads credentials only from environment variables — never hardcoded
 * — and only attempts a real call/SMS when ALL required env vars are
 * present. Otherwise it returns the same honest "not configured" result as
 * the local provider; it never pretends to have placed a call or sent a
 * message. Push and email are not implemented by Twilio, so those always
 * defer to the local (not-configured) provider.
 */
function credentials() {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const fromNumber = process.env.TWILIO_PHONE_NUMBER;
  if (!accountSid || !authToken || !fromNumber) return null;
  return { accountSid, authToken, fromNumber };
}

async function twilioRequest(
  accountSid: string,
  authToken: string,
  resource: "Calls" | "Messages",
  body: Record<string, string>
): Promise<ProviderResult> {
  try {
    const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/${resource}.json`;
    const auth = Buffer.from(`${accountSid}:${authToken}`).toString("base64");
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams(body).toString(),
    });

    if (!res.ok) {
      // Never log the auth token or the Authorization header — only the
      // response body Twilio itself returned.
      const text = await res.text().catch(() => "");
      return { outcome: "failed", detail: `Twilio ${resource} request failed (${res.status}): ${text}` };
    }

    const json = (await res.json().catch(() => null)) as { sid?: string } | null;
    return {
      outcome: "sent",
      detail: `Twilio ${resource} request accepted.`,
      providerRef: json?.sid,
    };
  } catch (err) {
    return {
      outcome: "failed",
      detail: `Twilio ${resource} request errored: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

export const twilioProvider: NotificationProvider = {
  sendPush: localProvider.sendPush,
  sendEmail: localProvider.sendEmail,

  async sendSms(to, message) {
    const creds = credentials();
    if (!creds) {
      return { outcome: "not_configured", detail: "SMS is not configured. Requires provider setup." };
    }
    const check = validatePhoneNumber(to);
    if (!check.valid) {
      return { outcome: "invalid_number", detail: check.reason ?? "Invalid phone number." };
    }
    return twilioRequest(creds.accountSid, creds.authToken, "Messages", {
      To: to,
      From: creds.fromNumber,
      Body: message,
    });
  },

  /**
   * Places a real outbound voice call via Twilio's REST Voice API using a
   * raw `fetch` (matching the existing fetch-based style already used
   * here for SMS and in webpush.ts, rather than pulling in the `twilio`
   * npm SDK). The spoken message is passed as inline TwiML via the
   * `Twiml` param (a `<Response><Say>...</Say></Response>` document),
   * which Twilio executes directly — no separate public TwiML-hosting
   * endpoint is required for this to work in any environment, including
   * local dev with no deployed URL.
   *
   * Never fabricates success: pre-flight number validation happens before
   * any network call and returns "invalid_number" without touching
   * Twilio; missing credentials return "not_configured"; only a genuine
   * Twilio 2xx/"queued" response returns "sent" (with the Call SID as
   * `providerRef`).
   */
  async placeCall(to, message) {
    const creds = credentials();
    if (!creds) {
      return { outcome: "not_configured", detail: "Phone calling is not configured yet." };
    }
    const check = validatePhoneNumber(to);
    if (!check.valid) {
      return { outcome: "invalid_number", detail: check.reason ?? "Invalid phone number." };
    }
    const twiml = `<Response><Say>${escapeForTwiml(message)}</Say></Response>`;
    return twilioRequest(creds.accountSid, creds.authToken, "Calls", {
      To: to,
      From: creds.fromNumber,
      Twiml: twiml,
    });
  },
};

export function isTwilioConfigured(): boolean {
  return credentials() !== null;
}
