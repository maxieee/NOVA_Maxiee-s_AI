import type { NotificationProvider, ProviderResult } from "./types";
import { localProvider } from "./local";

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
      const text = await res.text().catch(() => "");
      return { outcome: "failed", detail: `Twilio ${resource} request failed (${res.status}): ${text}` };
    }

    return { outcome: "sent", detail: `Twilio ${resource} request accepted.` };
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
    if (!to) {
      return { outcome: "failed", detail: "No phone number on file for this reminder." };
    }
    return twilioRequest(creds.accountSid, creds.authToken, "Messages", {
      To: to,
      From: creds.fromNumber,
      Body: message,
    });
  },

  async placeCall(to, message) {
    const creds = credentials();
    if (!creds) {
      return { outcome: "not_configured", detail: "Phone calling is not configured yet." };
    }
    if (!to) {
      return { outcome: "failed", detail: "No phone number on file for this reminder." };
    }
    // Twiml bin/echo: speak the message via Twilio's inline TwiML support.
    const twiml = `<Response><Say>${message.replace(/[<>&]/g, "")}</Say></Response>`;
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
