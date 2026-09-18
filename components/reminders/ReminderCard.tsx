import Link from "next/link";
import type { Reminder } from "@/types/reminder";
import { getUrgency, URGENCY_LABEL, URGENCY_COLOR } from "@/lib/scheduling/urgency";
import { formatFriendlyDate, formatTime } from "@/lib/utils/date";
import { TypeBadges } from "./TypeBadges";
import { ReminderActions } from "./ReminderActions";

const URGENCY_DOT: Record<string, string> = {
  overdue: "bg-nova-urgent",
  urgent: "bg-nova-warn",
  due_today: "bg-nova-accent",
  upcoming: "bg-nova-muted",
  completed: "bg-nova-good",
};

export function ReminderCard({ reminder, now }: { reminder: Reminder; now?: Date }) {
  const urgency = getUrgency(reminder, now);
  const isDone = reminder.status === "completed" || reminder.status === "cancelled";

  return (
    <Link
      href={`/reminders/${reminder.id}`}
      className="nova-card nova-card-hover animate-slide-up flex flex-col gap-3 p-4"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${URGENCY_DOT[urgency]}`} />
            <h3 className={`truncate text-sm font-semibold text-white ${isDone ? "line-through opacity-60" : ""}`}>
              {reminder.title}
            </h3>
          </div>
          {reminder.description && (
            <p className="mt-1 line-clamp-1 text-xs text-nova-muted">{reminder.description}</p>
          )}
        </div>
        <span className={`shrink-0 text-xs font-medium ${URGENCY_COLOR[urgency]}`}>
          {URGENCY_LABEL[urgency]}
        </span>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <TypeBadges types={reminder.types} />
        <div className="flex items-center gap-2 text-xs text-nova-muted">
          <span>{formatFriendlyDate(reminder.date)}</span>
          {reminder.time && <span>{formatTime(reminder.time)}</span>}
          {reminder.payment && (
            <span className="font-semibold text-white">
              {reminder.payment.currency} {reminder.payment.amount.toFixed(2)}
            </span>
          )}
        </div>
      </div>

      {!isDone && (
        <div className="border-t border-nova-border pt-3">
          <ReminderActions reminderId={reminder.id} compact />
        </div>
      )}
    </Link>
  );
}
