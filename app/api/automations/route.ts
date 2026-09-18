import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { AUTOMATION_TEMPLATES } from "@/lib/automation/templates";

export async function GET() {
  const userId = db.getCurrentUserId();
  const automations = db.listAutomations(userId);
  return NextResponse.json({ automations });
}

export async function POST(req: NextRequest) {
  const userId = db.getCurrentUserId();
  const body = (await req.json()) as { templateId?: string; values?: Record<string, string> };
  const template = AUTOMATION_TEMPLATES.find((t) => t.id === body.templateId);
  if (!template) {
    return NextResponse.json({ error: "Unknown template." }, { status: 400 });
  }
  const input = template.build(body.values ?? {});
  const automation = db.createAutomation(userId, input);
  return NextResponse.json({ automation });
}
