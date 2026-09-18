import { db } from "@/lib/db";
import { PageHeader } from "@/components/ui/PageHeader";

export const dynamic = "force-dynamic";

export default function SettingsPage() {
  const userId = db.getCurrentUserId();
  const prefs = db.getPreferences(userId);

  return (
    <div>
      <PageHeader title="Settings" subtitle="Tune how NOVA notifies and escalates" />

      <section className="grid gap-4 px-4 py-6 md:grid-cols-2 md:px-8">
        <div className="nova-card p-5">
          <h3 className="mb-4 text-sm font-semibold text-white">Profile</h3>
          <div className="space-y-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-nova-muted">Display name</span>
              <span className="text-white">{prefs.display_name}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-nova-muted">Theme</span>
              <span className="capitalize text-white">{prefs.theme}</span>
            </div>
          </div>
        </div>

        <div className="nova-card p-5">
          <h3 className="mb-4 text-sm font-semibold text-white">Reminder Schedule</h3>
          <div className="space-y-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-nova-muted">Payment lead days</span>
              <span className="text-white">{prefs.reminder_lead_days.join(", ")} days before</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-nova-muted">Repeat interval</span>
              <span className="text-white">Every {prefs.repeat_interval_minutes / 60}h</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-nova-muted">Escalation</span>
              <span className="text-white">{prefs.escalation_enabled ? "Enabled" : "Disabled"}</span>
            </div>
          </div>
        </div>

        <div className="nova-card p-5 md:col-span-2">
          <h3 className="mb-2 text-sm font-semibold text-white">Data Source</h3>
          <p className="text-sm text-nova-muted">
            NOVA is currently running on the local SQLite data layer, seeded with demo data. To
            connect a real Supabase/Postgres backend, set the environment variables documented in{" "}
            <code className="rounded bg-nova-surface2 px-1.5 py-0.5 text-xs text-nova-accent">
              .env.example
            </code>{" "}
            and run the SQL migrations under{" "}
            <code className="rounded bg-nova-surface2 px-1.5 py-0.5 text-xs text-nova-accent">
              database/migrations
            </code>
            . See the README for the full walkthrough.
          </p>
        </div>
      </section>
    </div>
  );
}
