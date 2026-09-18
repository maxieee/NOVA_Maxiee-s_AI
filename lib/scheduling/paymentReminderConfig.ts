/**
 * Centralized, data-driven lead-time schedule for payment-cycle reminders —
 * mirrors how lib/notifications/followUpConfig.ts centralizes V3's timing
 * instead of scattering hardcoded day counts through cycle/reminder logic.
 *
 * The "overdue" leg is NOT listed here: once the reminder's occurrence goes
 * past due_date, the EXISTING follow-up/escalation engine
 * (lib/notifications/escalation.ts decideFollowUp, driven by dueScan) takes
 * over entirely — no separate overdue-specific logic is added for payments.
 */
export interface PaymentLeadTime {
  daysBeforeDue: number;
  label: string;
}

export const DEFAULT_PAYMENT_LEAD_TIMES: PaymentLeadTime[] = [
  { daysBeforeDue: 7, label: "Due in 7 days" },
  { daysBeforeDue: 3, label: "Due in 3 days" },
  { daysBeforeDue: 1, label: "Due tomorrow" },
];

/** The due-date-morning notification itself, always included after the lead times. */
export const ON_DUE_DATE_LABEL = "Due today";
