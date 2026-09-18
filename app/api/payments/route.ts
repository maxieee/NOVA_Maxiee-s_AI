import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ensureUpcomingCycle } from "@/lib/scheduling/paymentCycles";
import { generateReminderForCycle } from "@/lib/scheduling/paymentReminders";
import type { PaymentAccountInput } from "@/types/reminder";

export async function GET() {
  const userId = db.getCurrentUserId();
  const accounts = db.listPaymentAccounts(userId);
  const withCycles = accounts.map((account) => ({
    account,
    cycles: db.listPaymentCycles(account.id),
  }));
  return NextResponse.json({ accounts: withCycles });
}

export async function POST(req: NextRequest) {
  const userId = db.getCurrentUserId();
  const body = (await req.json().catch(() => null)) as Partial<PaymentAccountInput> | null;

  if (!body?.name || !body.payment_type || !body.due_date_rule) {
    return NextResponse.json(
      { error: "name, payment_type and due_date_rule are required" },
      { status: 400 }
    );
  }

  const input: PaymentAccountInput = {
    name: body.name,
    payment_type: body.payment_type,
    issuer: body.issuer ?? null,
    masked_identifier: body.masked_identifier ?? null,
    active: body.active ?? true,
    statement_date_rule: body.statement_date_rule ?? 1,
    due_date_rule: body.due_date_rule,
    fixed_due_day: body.fixed_due_day ?? null,
    due_days_after_statement: body.due_days_after_statement ?? null,
    default_amount: body.default_amount ?? 0,
    minimum_amount: body.minimum_amount ?? null,
    autopay_enabled: body.autopay_enabled ?? false,
    reminder_enabled: body.reminder_enabled ?? true,
    escalation_enabled: body.escalation_enabled ?? true,
  };

  const account = db.createPaymentAccount(userId, input);

  // Immediately generate the first cycle + its reminder so the account
  // shows up with a real next-due-date right away, rather than waiting
  // for the next cron tick.
  const preferences = db.getPreferences(userId);
  const cycle = ensureUpcomingCycle(account);
  generateReminderForCycle(cycle, account, userId, preferences.preferred_channels, preferences.default_intensity);

  return NextResponse.json({ account, cycle: db.getPaymentCycle(cycle.id) }, { status: 201 });
}
