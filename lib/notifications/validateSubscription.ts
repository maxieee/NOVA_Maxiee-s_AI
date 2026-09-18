interface SubscribeBody {
  endpoint?: unknown;
  keys?: { p256dh?: unknown; auth?: unknown };
}

/** Validates a browser PushSubscription payload before persisting it. */
export function validateSubscriptionPayload(body: SubscribeBody): string | null {
  if (!body || typeof body.endpoint !== "string" || !body.endpoint.startsWith("http")) {
    return "Missing or invalid endpoint.";
  }
  if (!body.keys || typeof body.keys.p256dh !== "string" || !body.keys.p256dh) {
    return "Missing keys.p256dh.";
  }
  if (typeof body.keys.auth !== "string" || !body.keys.auth) {
    return "Missing keys.auth.";
  }
  return null;
}
