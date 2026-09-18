import { PageHeader } from "@/components/ui/PageHeader";
import { CreateReminderForm } from "@/components/reminders/CreateReminderForm";

export default function NewReminderPage() {
  return (
    <div>
      <PageHeader title="Create Reminder" subtitle="Pick one or more types, then fill in the details" />
      <div className="mx-auto max-w-2xl px-4 py-6 md:px-8">
        <CreateReminderForm />
      </div>
    </div>
  );
}
