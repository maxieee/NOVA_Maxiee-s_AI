import type { AutomationInput } from "@/types/reminder";

/**
 * V11 ships a small, fixed set of pre-defined, safely-parameterized
 * automation templates rather than a full arbitrary trigger/condition/
 * action composer UI — an explicit, documented scope decision (see the
 * V11 report). Each template maps straight onto the trigger/action pairs
 * lib/automation/engine.ts actually implements.
 */
export interface AutomationTemplate {
  id: string;
  label: string;
  description: string;
  fields: Array<{ key: string; label: string; type: "text" | "number"; placeholder?: string }>;
  build(values: Record<string, string>): AutomationInput;
}

export const AUTOMATION_TEMPLATES: AutomationTemplate[] = [
  {
    id: "followup_on_complete",
    label: "When a reminder is completed, create a follow-up reminder",
    description:
      "Whenever you mark a reminder done, NOVA creates a new follow-up reminder a set number of days later.",
    fields: [
      { key: "followUpTitle", label: "Follow-up reminder title", type: "text", placeholder: "Check back in" },
      { key: "daysLater", label: "Days after completion", type: "number", placeholder: "7" },
    ],
    build(values) {
      return {
        name: `Follow up: ${values.followUpTitle || "Untitled"}`,
        trigger_type: "reminder_completed",
        trigger_config: {},
        action_type: "create_reminder",
        action_config: {
          title: values.followUpTitle || "Follow up",
          daysFromNow: Number(values.daysLater) || 7,
          priority: "medium",
        },
        enabled: true,
      };
    },
  },
  {
    id: "weekly_review",
    label: "Every Monday, remind me to review the week",
    description: "A recurring reminder created once per week via the automation engine's cron_weekly trigger.",
    fields: [{ key: "message", label: "Reminder message", type: "text", placeholder: "Review the week ahead" }],
    build(values) {
      return {
        name: "Weekly review reminder",
        trigger_type: "cron_weekly",
        trigger_config: {},
        action_type: "create_reminder",
        action_config: {
          title: values.message || "Review the week ahead",
          daysFromNow: 0,
          priority: "medium",
        },
        enabled: true,
      };
    },
  },
  {
    id: "payment_overdue_alert",
    label: "When a payment is overdue, send me a notification",
    description: "Fires once per overdue payment cycle, using your existing notification channel.",
    fields: [{ key: "message", label: "Notification message", type: "text", placeholder: "A payment is overdue" }],
    build(values) {
      return {
        name: "Payment overdue alert",
        trigger_type: "payment_overdue",
        trigger_config: {},
        action_type: "send_notification",
        action_config: {
          message: values.message || "A payment is overdue — please check Settings.",
        },
        enabled: true,
      };
    },
  },
];
