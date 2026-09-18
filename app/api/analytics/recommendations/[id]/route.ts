import { NextRequest, NextResponse } from "next/server";
import { applyRecommendation, dismissRecommendation } from "@/lib/analytics/apply";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await req.json()) as { action?: "apply" | "dismiss" };

  if (body.action === "apply") {
    const record = await applyRecommendation(id);
    return NextResponse.json({ recommendation: record });
  }
  if (body.action === "dismiss") {
    const record = await dismissRecommendation(id);
    return NextResponse.json({ recommendation: record });
  }
  return NextResponse.json({ error: "action must be 'apply' or 'dismiss'" }, { status: 400 });
}
