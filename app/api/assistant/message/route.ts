import { NextRequest, NextResponse } from "next/server";
import { handleAssistantMessage } from "@/lib/assistant/pipeline";

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as { text?: string; sessionId?: string } | null;
  const text = body?.text?.trim();
  const sessionId = body?.sessionId?.trim();

  if (!text) {
    return NextResponse.json({ error: "text is required" }, { status: 400 });
  }
  if (!sessionId) {
    return NextResponse.json({ error: "sessionId is required" }, { status: 400 });
  }

  const result = await handleAssistantMessage(text, sessionId);
  return NextResponse.json(result);
}
