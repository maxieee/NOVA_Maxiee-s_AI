"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type {
  UserPreferences,
  NotificationChannel,
  ReminderIntensity,
  NotificationBehavior,
} from "@/types/reminder";

const CHANNELS: { value: NotificationChannel; label: string }[] = [
  { value: "push", label: "Push" },
  { value: "sms", label: "SMS" },
  { value: "email", label: "Email" },
  { value: "call", label: "Phone Call" },
];

const INTENSITIES: ReminderIntensity[] = ["gentle", "normal", "persistent", "critical"];
const BEHAVIORS: NotificationBehavior[] = ["notify_once", "repeat_until_done", "silent"];

const inputClass =
  "w-full rounded-xl border border-nova-border bg-nova-surface2 px-3 py-2 text-sm text-white outline-none transition-colors focus:border-nova-accent";

export function PersonalizationForm({ preferences }: { preferences: UserPreferences }) {
  const router = useRouter();
  const [form, setForm] = useState(preferences);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  function set<K extends keyof UserPreferences>(key: K, value: UserPreferences[K]) {
    setForm((f) => ({ ...f, [key]: value }));
    setSaved(false);
  }

  function toggleChannel(channel: NotificationChannel) {
    const next = form.preferred_channels.includes(channel)
      ? form.preferred_channels.filter((c) => c !== channel)
      : [...form.preferred_channels, channel];
    set("preferred_channels", next);
  }

  async function save() {
    setSaving(true);
    await fetch("/api/preferences", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    setSaving(false);
    setSaved(true);
    router.refresh();
  }

  return (
    <div className="nova-card space-y-5 p-5">
      <div>
        <h3 className="text-sm font-semibold text-white">Personalization</h3>
        <p className="mt-1 text-xs text-nova-muted">
          Everything here is entered by you and stored in your preferences — nothing is assumed.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-nova-muted">Preferred name</span>
          <input
            className={inputClass}
            value={form.preferred_name ?? ""}
            onChange={(e) => set("preferred_name", e.target.value)}
            placeholder="What should we display?"
          />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-nova-muted">What NOVA should call you</span>
          <input
            className={inputClass}
            value={form.nova_should_call_user ?? ""}
            onChange={(e) => set("nova_should_call_user", e.target.value)}
            placeholder="e.g. boss, champ, your name"
          />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-nova-muted">Default reminder time</span>
          <input
            type="time"
            className={inputClass}
            value={form.default_reminder_time}
            onChange={(e) => set("default_reminder_time", e.target.value)}
          />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-nova-muted">Default snooze (minutes)</span>
          <input
            type="number"
            min={1}
            className={inputClass}
            value={form.default_snooze_minutes}
            onChange={(e) => set("default_snooze_minutes", parseInt(e.target.value, 10) || 15)}
          />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-nova-muted">Timezone</span>
          <input
            className={inputClass}
            value={form.timezone}
            onChange={(e) => set("timezone", e.target.value)}
            placeholder="e.g. America/New_York"
          />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-nova-muted">Default notification behavior</span>
          <select
            className={inputClass}
            value={form.default_notification_behavior}
            onChange={(e) => set("default_notification_behavior", e.target.value as NotificationBehavior)}
          >
            {BEHAVIORS.map((b) => (
              <option key={b} value={b}>
                {b.replace(/_/g, " ")}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-nova-muted">Quiet hours start</span>
          <input
            type="time"
            className={inputClass}
            value={form.quiet_hours_start ?? ""}
            onChange={(e) => set("quiet_hours_start", e.target.value || null)}
          />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-nova-muted">Quiet hours end</span>
          <input
            type="time"
            className={inputClass}
            value={form.quiet_hours_end ?? ""}
            onChange={(e) => set("quiet_hours_end", e.target.value || null)}
          />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-nova-muted">Default reminder intensity</span>
          <select
            className={inputClass}
            value={form.default_intensity}
            onChange={(e) => set("default_intensity", e.target.value as ReminderIntensity)}
          >
            {INTENSITIES.map((i) => (
              <option key={i} value={i} className="capitalize">
                {i}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div>
        <span className="mb-1.5 block text-xs font-medium text-nova-muted">Preferred notification channels</span>
        <div className="flex flex-wrap gap-2">
          {CHANNELS.map((c) => {
            const active = form.preferred_channels.includes(c.value);
            return (
              <button
                type="button"
                key={c.value}
                onClick={() => toggleChannel(c.value)}
                className={`nova-chip ${active ? "nova-chip-active" : ""}`}
              >
                {c.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:gap-6">
        <label className="flex items-center gap-2 text-sm text-white">
          <input
            type="checkbox"
            checked={form.repeat_ignored_reminders}
            onChange={(e) => set("repeat_ignored_reminders", e.target.checked)}
            className="h-4 w-4 rounded border-nova-border bg-nova-surface2 accent-nova-accent"
          />
          Repeat reminders I ignore
        </label>
        <label className="flex items-center gap-2 text-sm text-white">
          <input
            type="checkbox"
            checked={form.escalate_urgent_reminders}
            onChange={(e) => set("escalate_urgent_reminders", e.target.checked)}
            className="h-4 w-4 rounded border-nova-border bg-nova-surface2 accent-nova-primary"
          />
          Escalate urgent reminders
        </label>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-nova-muted">
            Max follow-up attempts
          </span>
          <input
            type="number"
            min={1}
            className={inputClass}
            value={form.max_follow_up_attempts}
            onChange={(e) => set("max_follow_up_attempts", parseInt(e.target.value, 10) || 8)}
          />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-nova-muted">
            Escalation threshold (repeats)
          </span>
          <input
            type="number"
            min={1}
            className={inputClass}
            value={form.escalation_threshold_repeats}
            onChange={(e) => set("escalation_threshold_repeats", parseInt(e.target.value, 10) || 3)}
          />
        </label>
      </div>

      <div className="flex items-center gap-3">
        <button type="button" onClick={save} disabled={saving} className="nova-btn-primary">
          {saving ? "Saving…" : "Save Personalization"}
        </button>
        {saved && <span className="text-xs text-nova-good">Saved.</span>}
      </div>
    </div>
  );
}
