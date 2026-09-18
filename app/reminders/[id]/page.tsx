import { db } from "@/lib/db";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui/PageHeader";
import { TypeBadges } from "@/components/reminders/TypeBadges";
import { ReminderActions } from "@/components/reminders/ReminderActions";
import { getUrgency, URGENCY_LABEL, URGENCY_COLOR } from "@/lib/scheduling/urgency";
import { formatFriendlyDate, formatTime } from "@/lib/utils/date";

export const dynamic = "force-dynamic";

export default async function ReminderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const reminder = db.getReminder(id);
  if (!reminder) notFound();

  const history = db.listHistory(id);
  const occurrences = db.listOccurrences(id);
  const urgency = getUrgency(reminder);
  const isDone = reminder.status === "completed" || reminder.status === "cancelled";

  return (
    <div>
      <PageHeader title={reminder.title} subtitle={reminder.description ?? undefined} />

      <div className="grid gap-6 px-4 py-6 md:grid-cols-3 md:px-8">
        <div className="space-y-6 md:col-span-2">
          <div className="nova-card p-5">
            <div className="mb-4 flex items-center justify-between">
              <TypeBadges types={reminder.types} />
              <span className={`text-sm font-medium ${URGENCY_COLOR[urgency]}`}>
                {URGENCY_LABEL[urgency]}
              </span>
            </div>

            <dl className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <dt className="text-nova-muted">Date</dt>
                <dd className="text-white">{formatFriendlyDate(reminder.date)}</dd>
              </div>
              {reminder.time && (
                <div>
                  <dt className="text-nova-muted">Time</dt>
                  <dd className="text-white">{formatTime(reminder.time)}</dd>
                </div>
              )}
              <div>
                <dt className="text-nova-muted">Priority</dt>
                <dd className="capitalize text-white">{reminder.priority}</dd>
              </div>
              <div>
                <dt className="text-nova-muted">Status</dt>
                <dd className="capitalize text-white">{reminder.status}</dd>
              </div>
              <div>
                <dt className="text-nova-muted">Intensity</dt>
                <dd className="capitalize text-white">{reminder.intensity}</dd>
              </div>
              <div>
                <dt className="text-nova-muted">Notification channels</dt>
                <dd className="capitalize text-white">
                  {reminder.channels.length ? reminder.channels.join(", ") : "None selected"}
                </dd>
              </div>
            </dl>

            {reminder.notes && (
              <div className="mt-4 rounded-lg bg-nova-surface2 p-3 text-sm text-nova-muted">
                {reminder.notes}
              </div>
            )}

            {!isDone && (
              <div className="mt-5 border-t border-nova-border pt-5">
                <ReminderActions reminderId={reminder.id} />
              </div>
            )}
          </div>

          {reminder.payment && (
            <div className="nova-card p-5">
              <h3 className="mb-3 text-sm font-semibold text-white">Payment Details</h3>
              <dl className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <dt className="text-nova-muted">Amount</dt>
                  <dd className="text-white">
                    {reminder.payment.currency} {reminder.payment.amount.toFixed(2)}
                  </dd>
                </div>
                <div>
                  <dt className="text-nova-muted">Payee</dt>
                  <dd className="text-white">{reminder.payment.payee ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-nova-muted">Due Date</dt>
                  <dd className="text-white">{formatFriendlyDate(reminder.payment.due_date)}</dd>
                </div>
                <div>
                  <dt className="text-nova-muted">Status</dt>
                  <dd className="capitalize text-white">{reminder.payment.paid_status}</dd>
                </div>
                <div>
                  <dt className="text-nova-muted">Category</dt>
                  <dd className="capitalize text-white">{reminder.payment.category.replace("_", " ")}</dd>
                </div>
                <div>
                  <dt className="text-nova-muted">Autopay</dt>
                  <dd className="text-white">{reminder.payment.autopay ? "Yes" : "No"}</dd>
                </div>
              </dl>
            </div>
          )}

          {reminder.call && (
            <div className="nova-card p-5">
              <h3 className="mb-3 text-sm font-semibold text-white">Call Details</h3>
              <p className="text-sm text-white">{reminder.call.contact_name}</p>
              {reminder.call.phone_number && (
                <p className="text-sm text-nova-muted">{reminder.call.phone_number}</p>
              )}
            </div>
          )}

          {reminder.meeting && (
            <div className="nova-card p-5">
              <h3 className="mb-3 text-sm font-semibold text-white">Meeting Details</h3>
              {reminder.meeting.location && (
                <p className="text-sm text-white">Location: {reminder.meeting.location}</p>
              )}
              {reminder.meeting.meeting_link && (
                <p className="text-sm text-nova-accent">{reminder.meeting.meeting_link}</p>
              )}
              {reminder.meeting.attendees && reminder.meeting.attendees.length > 0 && (
                <p className="mt-1 text-sm text-nova-muted">
                  Attendees: {reminder.meeting.attendees.join(", ")}
                </p>
              )}
            </div>
          )}

          {reminder.follow_up && (
            <div className="nova-card p-5">
              <h3 className="mb-3 text-sm font-semibold text-white">Follow-up Details</h3>
              <p className="text-sm text-white">{reminder.follow_up.related_to ?? "—"}</p>
              {reminder.follow_up.last_contacted_at && (
                <p className="text-sm text-nova-muted">
                  Last contacted: {formatFriendlyDate(reminder.follow_up.last_contacted_at)}
                </p>
              )}
            </div>
          )}

          {reminder.recurrence && (
            <div className="nova-card p-5">
              <h3 className="mb-3 text-sm font-semibold text-white">Recurrence</h3>
              <p className="text-sm text-white capitalize">
                Every {reminder.recurrence.interval} {reminder.recurrence.frequency.replace("_", " ")}
              </p>
              {reminder.next_occurrence && (
                <p className="text-sm text-nova-muted">
                  Next: {new Date(reminder.next_occurrence).toLocaleString()}
                </p>
              )}
            </div>
          )}
        </div>

        <div className="space-y-4">
          <div className="nova-card p-5">
            <h3 className="mb-3 text-sm font-semibold text-white">Scheduled Occurrences</h3>
            <ul className="space-y-2 text-sm">
              {occurrences.map((o) => (
                <li key={o.id} className="flex items-center justify-between">
                  <span className="text-nova-muted">
                    {new Date(o.scheduled_for).toLocaleString(undefined, {
                      month: "short",
                      day: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </span>
                  <span className="capitalize text-white">{o.status}</span>
                </li>
              ))}
              {occurrences.length === 0 && <li className="text-nova-muted">None scheduled</li>}
            </ul>
          </div>

          <div className="nova-card p-5">
            <h3 className="mb-3 text-sm font-semibold text-white">History</h3>
            <ul className="space-y-3 text-sm">
              {history.map((h) => (
                <li key={h.id}>
                  <p className="capitalize text-white">{h.action}</p>
                  {h.detail && <p className="text-xs text-nova-muted">{h.detail}</p>}
                  <p className="text-xs text-nova-muted">
                    {new Date(h.created_at).toLocaleString()}
                  </p>
                </li>
              ))}
              {history.length === 0 && <li className="text-nova-muted">No history yet</li>}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
