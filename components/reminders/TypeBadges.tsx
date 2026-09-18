import type { ReminderTypeKey } from "@/types/reminder";
import { Icon } from "@/components/ui/Icon";

export const TYPE_META: Record<ReminderTypeKey, { label: string; icon: string; color: string }> = {
  task: { label: "Task", icon: "check-square", color: "text-nova-primary" },
  payment: { label: "Payment", icon: "credit-card", color: "text-nova-warn" },
  call: { label: "Call", icon: "phone", color: "text-nova-accent" },
  meeting: { label: "Meeting", icon: "users", color: "text-nova-primary2" },
  follow_up: { label: "Follow-up", icon: "repeat", color: "text-pink-400" },
  important_date: { label: "Important Date", icon: "star", color: "text-nova-urgent" },
  general: { label: "General", icon: "bell", color: "text-nova-muted" },
  recurring: { label: "Recurring", icon: "refresh-cw", color: "text-nova-good" },
};

export function TypeBadges({ types }: { types: ReminderTypeKey[] }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {types.map((t) => {
        const meta = TYPE_META[t];
        return (
          <span key={t} className="nova-chip">
            <Icon name={meta.icon} className={`h-3.5 w-3.5 ${meta.color}`} />
            {meta.label}
          </span>
        );
      })}
    </div>
  );
}
