import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { googleCalendarConnector } from "@/lib/integrations/googleCalendar";

/**
 * Honest integration status — never reports "connected" unless a real
 * token exchange previously succeeded and was persisted to
 * integration_accounts.
 */
export async function GET() {
  const userId = await db.getCurrentUserId();
  const account = await db.getIntegrationAccount(userId, "google_calendar");
  return NextResponse.json({
    integrations: [
      {
        provider: "google_calendar",
        name: googleCalendarConnector.name,
        configured: googleCalendarConnector.isConfigured(),
        status: account?.status ?? "not_connected",
        connectedAt: account?.connected_at ?? null,
        lastSyncAt: account?.last_sync_at ?? null,
        lastError: account?.last_error ?? null,
      },
    ],
  });
}
