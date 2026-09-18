import { NextResponse } from "next/server";

/**
 * Exposes only the VAPID public key to the client. The private key never
 * leaves the server — it is read only inside lib/notifications/providers/webpush.ts.
 */
export async function GET() {
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || process.env.VAPID_PUBLIC_KEY || null;
  return NextResponse.json({ publicKey });
}
