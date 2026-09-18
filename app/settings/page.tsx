import { db } from "@/lib/db";
import { PageHeader } from "@/components/ui/PageHeader";
import { PersonalizationForm } from "@/components/settings/PersonalizationForm";
import { PersonalAssistantMemory } from "@/components/settings/PersonalAssistantMemory";
import { PushNotificationSettings } from "@/components/settings/PushNotificationSettings";
import { PhoneCallSettings } from "@/components/settings/PhoneCallSettings";
import { ProactiveIntelligenceSettings } from "@/components/settings/ProactiveIntelligenceSettings";
import { IntegrationsSettings } from "@/components/settings/IntegrationsSettings";
import { isTwilioConfigured } from "@/lib/notifications/providers";

export const dynamic = "force-dynamic";

export default function SettingsPage() {
  const userId = db.getCurrentUserId();
  const prefs = db.getPreferences(userId);
  const personalContext = db.listPersonalContext(userId);
  const proactiveHistory = db.listProactiveNotifications(userId, 10);

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

        <div className="md:col-span-2">
          <PersonalizationForm preferences={prefs} />
        </div>

        <div className="md:col-span-2">
          <PersonalAssistantMemory entries={personalContext} />
        </div>

        <div className="md:col-span-2">
          <PushNotificationSettings />
        </div>

        <div className="md:col-span-2">
          <PhoneCallSettings initialPhoneNumber={prefs.phone_number} />
        </div>

        <div className="md:col-span-2">
          <ProactiveIntelligenceSettings
            enabled={prefs.proactive_intelligence_enabled}
            history={proactiveHistory}
          />
        </div>

        <div className="md:col-span-2">
          <IntegrationsSettings />
        </div>

        <div className="nova-card p-5 md:col-span-2">
          <h3 className="mb-2 text-sm font-semibold text-white">Automations</h3>
          <p className="text-sm text-nova-muted">
            Set up rules like &quot;when a reminder is completed, create a follow-up&quot; or
            &quot;every Monday, remind me to review the week&quot; — full run history included.
          </p>
          <a
            href="/automations"
            className="mt-3 inline-block rounded-full bg-nova-primary/20 px-4 py-1.5 text-xs font-medium text-nova-primary"
          >
            Manage automations
          </a>
        </div>

        <div className="nova-card p-5 md:col-span-2">
          <h3 className="mb-2 text-sm font-semibold text-white">Notification Providers</h3>
          <p className="text-sm text-nova-muted">
            Phone calling and SMS are powered by Twilio and are{" "}
            <span className={isTwilioConfigured() ? "text-nova-good" : "text-nova-primary"}>
              {isTwilioConfigured() ? "configured" : "not configured — requires provider setup"}
            </span>
            . Push and email have no provider wired up in this build; reminders using those channels
            will show as &quot;not configured&quot; rather than pretending to send.
          </p>
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
