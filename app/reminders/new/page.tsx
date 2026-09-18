import { db } from "@/lib/db";
import { PageHeader } from "@/components/ui/PageHeader";
import { CreateReminderForm } from "@/components/reminders/CreateReminderForm";

export const dynamic = "force-dynamic";

export default function NewReminderPage() {
  const userId = db.getCurrentUserId();
  const prefs = db.getPreferences(userId);

  return (
    <div>
      <PageHeader title="Create Reminder" subtitle="Pick one or more types, then fill in the details" />
      <div className="mx-auto max-w-2xl px-4 py-6 md:px-8">
        <CreateReminderForm
          defaultTime={prefs.default_reminder_time}
          defaultIntensity={prefs.default_intensity}
          defaultChannels={prefs.preferred_channels.length ? prefs.preferred_channels : ["push"]}
        />
      </div>
    </div>
  );
}
