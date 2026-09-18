"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type {
  Priority,
  ReminderInput,
  ReminderTypeKey,
  RecurrenceFrequency,
  NotificationChannel,
  ReminderIntensity,
} from "@/types/reminder";
import { TypeSelector } from "./TypeSelector";
import { todayISO } from "@/lib/utils/date";

const PRIORITIES: Priority[] = ["low", "medium", "high", "urgent"];
const FREQUENCIES: RecurrenceFrequency[] = ["daily", "weekly", "monthly", "yearly"];

const CHANNEL_OPTIONS: { value: NotificationChannel; label: string }[] = [
  { value: "push", label: "Push" },
  { value: "call", label: "Phone Call" },
  { value: "sms", label: "SMS" },
  { value: "email", label: "Email" },
];

const INTENSITY_OPTIONS: { value: ReminderIntensity; label: string; hint: string }[] = [
  { value: "gentle", label: "Gentle", hint: "A single, quiet nudge" },
  { value: "normal", label: "Normal", hint: "Repeats a few times if ignored" },
  { value: "persistent", label: "Persistent", hint: "Repeats often, escalates sooner" },
  { value: "critical", label: "Critical", hint: "Escalates immediately if configured" },
];

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-nova-muted">{label}</span>
      {children}
    </label>
  );
}

const inputClass =
  "w-full rounded-xl border border-nova-border bg-nova-surface2 px-3 py-2.5 text-sm text-white outline-none transition-colors focus:border-nova-primary";

export function CreateReminderForm({
  defaultTime = "09:00",
  defaultIntensity = "normal",
  defaultChannels = ["push"],
}: {
  defaultTime?: string;
  defaultIntensity?: ReminderIntensity;
  defaultChannels?: NotificationChannel[];
} = {}) {
  const router = useRouter();
  const [types, setTypes] = useState<ReminderTypeKey[]>([]);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [date, setDate] = useState(todayISO());
  const [time, setTime] = useState(defaultTime);
  const [priority, setPriority] = useState<Priority>("medium");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Type-specific fields
  const [amount, setAmount] = useState("");
  const [payee, setPayee] = useState("");
  const [dueDate, setDueDate] = useState(todayISO());
  const [category, setCategory] = useState<"credit_card" | "bill" | "emi" | "subscription" | "loan" | "other">(
    "bill"
  );
  const [autopay, setAutopay] = useState(false);

  const [contactName, setContactName] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");

  const [location, setLocation] = useState("");
  const [meetingLink, setMeetingLink] = useState("");

  const [relatedTo, setRelatedTo] = useState("");

  const [frequency, setFrequency] = useState<RecurrenceFrequency>("monthly");
  const [interval, setInterval] = useState(1);

  const [channels, setChannels] = useState<NotificationChannel[]>(defaultChannels);
  const [intensity, setIntensity] = useState<ReminderIntensity>(defaultIntensity);

  function toggleChannel(channel: NotificationChannel) {
    setChannels((prev) =>
      prev.includes(channel) ? prev.filter((c) => c !== channel) : [...prev, channel]
    );
  }

  function has(type: ReminderTypeKey) {
    return types.includes(type);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!title.trim()) {
      setError("Give your reminder a title.");
      return;
    }
    if (types.length === 0) {
      setError("Select at least one reminder type.");
      return;
    }

    const input: ReminderInput = {
      title,
      description: description || undefined,
      date,
      time: time || undefined,
      priority,
      notes: notes || undefined,
      types,
      channels,
      intensity,
    };

    if (has("payment")) {
      input.payment = {
        amount: parseFloat(amount || "0"),
        currency: "USD",
        payee: payee || undefined,
        category,
        due_date: dueDate || date,
        autopay,
      };
    }
    if (has("call")) {
      input.call = { contact_name: contactName || title, phone_number: phoneNumber || undefined };
    }
    if (has("meeting")) {
      input.meeting = { location: location || undefined, meeting_link: meetingLink || undefined };
    }
    if (has("follow_up")) {
      input.follow_up = { related_to: relatedTo || undefined };
    }
    if (has("recurring")) {
      input.recurrence = { frequency, interval };
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/reminders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Failed to create reminder");
      }
      const { reminder } = await res.json();
      router.push(`/reminders/${reminder.id}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-8">
      <section>
        <h2 className="mb-3 text-sm font-semibold text-white">1. What kind of reminder is this?</h2>
        <p className="mb-4 text-xs text-nova-muted">Select one or more — combinations are fully supported.</p>
        <TypeSelector selected={types} onChange={setTypes} />
      </section>

      <section className="nova-card animate-fade-in space-y-4 p-5">
        <h2 className="text-sm font-semibold text-white">2. Basics</h2>
        <Field label="Title">
          <input
            className={inputClass}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Pay electricity bill"
            required
          />
        </Field>
        <Field label="Description">
          <textarea
            className={inputClass}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            placeholder="Optional details"
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Date">
            <input
              type="date"
              className={inputClass}
              value={date}
              onChange={(e) => setDate(e.target.value)}
              required
            />
          </Field>
          <Field label="Time">
            <input
              type="time"
              className={inputClass}
              value={time}
              onChange={(e) => setTime(e.target.value)}
            />
          </Field>
        </div>
        <Field label="Priority">
          <div className="flex gap-2">
            {PRIORITIES.map((p) => (
              <button
                type="button"
                key={p}
                onClick={() => setPriority(p)}
                className={`nova-chip capitalize ${priority === p ? "nova-chip-active" : ""}`}
              >
                {p}
              </button>
            ))}
          </div>
        </Field>
        <Field label="Notes">
          <textarea
            className={inputClass}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            placeholder="Any extra notes"
          />
        </Field>
      </section>

      {has("payment") && (
        <section className="nova-card animate-fade-in space-y-4 p-5">
          <h2 className="text-sm font-semibold text-white">Payment details</h2>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Amount">
              <input
                type="number"
                step="0.01"
                className={inputClass}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
              />
            </Field>
            <Field label="Payee">
              <input
                className={inputClass}
                value={payee}
                onChange={(e) => setPayee(e.target.value)}
                placeholder="e.g. Electric Company"
              />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Due Date">
              <input
                type="date"
                className={inputClass}
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
              />
            </Field>
            <Field label="Category">
              <select
                className={inputClass}
                value={category}
                onChange={(e) => setCategory(e.target.value as typeof category)}
              >
                <option value="credit_card">Credit Card</option>
                <option value="bill">Bill</option>
                <option value="emi">EMI</option>
                <option value="subscription">Subscription</option>
                <option value="loan">Loan</option>
                <option value="other">Other</option>
              </select>
            </Field>
          </div>
          <label className="flex items-center gap-2 text-sm text-white">
            <input
              type="checkbox"
              checked={autopay}
              onChange={(e) => setAutopay(e.target.checked)}
              className="h-4 w-4 rounded border-nova-border bg-nova-surface2 accent-nova-primary"
            />
            Autopay enabled
          </label>
        </section>
      )}

      {has("call") && (
        <section className="nova-card animate-fade-in space-y-4 p-5">
          <h2 className="text-sm font-semibold text-white">Call details</h2>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Contact name">
              <input
                className={inputClass}
                value={contactName}
                onChange={(e) => setContactName(e.target.value)}
                placeholder="e.g. Mom"
              />
            </Field>
            <Field label="Phone number">
              <input
                className={inputClass}
                value={phoneNumber}
                onChange={(e) => setPhoneNumber(e.target.value)}
                placeholder="Optional"
              />
            </Field>
          </div>
        </section>
      )}

      {has("meeting") && (
        <section className="nova-card animate-fade-in space-y-4 p-5">
          <h2 className="text-sm font-semibold text-white">Meeting details</h2>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Location">
              <input
                className={inputClass}
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="e.g. Conference Room A"
              />
            </Field>
            <Field label="Meeting link">
              <input
                className={inputClass}
                value={meetingLink}
                onChange={(e) => setMeetingLink(e.target.value)}
                placeholder="Optional video link"
              />
            </Field>
          </div>
        </section>
      )}

      {has("follow_up") && (
        <section className="nova-card animate-fade-in space-y-4 p-5">
          <h2 className="text-sm font-semibold text-white">Follow-up details</h2>
          <Field label="Related to">
            <input
              className={inputClass}
              value={relatedTo}
              onChange={(e) => setRelatedTo(e.target.value)}
              placeholder="e.g. Acme Corp proposal"
            />
          </Field>
        </section>
      )}

      {has("recurring") && (
        <section className="nova-card animate-fade-in space-y-4 p-5">
          <h2 className="text-sm font-semibold text-white">Recurrence</h2>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Frequency">
              <select
                className={inputClass}
                value={frequency}
                onChange={(e) => setFrequency(e.target.value as RecurrenceFrequency)}
              >
                {FREQUENCIES.map((f) => (
                  <option key={f} value={f} className="capitalize">
                    {f}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Every">
              <input
                type="number"
                min={1}
                className={inputClass}
                value={interval}
                onChange={(e) => setInterval(parseInt(e.target.value, 10) || 1)}
              />
            </Field>
          </div>
        </section>
      )}

      <section className="nova-card animate-fade-in space-y-4 p-5">
        <div>
          <h2 className="text-sm font-semibold text-white">Notification Method</h2>
          <p className="mt-1 text-xs text-nova-muted">
            Choose any combination. Channels without a configured provider will clearly say so instead
            of pretending to deliver.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          {CHANNEL_OPTIONS.map((opt) => {
            const active = channels.includes(opt.value);
            return (
              <button
                type="button"
                key={opt.value}
                onClick={() => toggleChannel(opt.value)}
                aria-pressed={active}
                className={`rounded-xl border p-3 text-center text-xs font-medium transition-colors duration-150 ${
                  active
                    ? "border-nova-accent bg-nova-accent/15 text-white"
                    : "border-nova-border bg-nova-surface text-nova-muted hover:border-nova-accent/40"
                }`}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      </section>

      <section className="nova-card animate-fade-in space-y-4 p-5">
        <div>
          <h2 className="text-sm font-semibold text-white">Reminder Intensity</h2>
          <p className="mt-1 text-xs text-nova-muted">How persistent should NOVA be if this gets ignored?</p>
        </div>
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          {INTENSITY_OPTIONS.map((opt) => {
            const active = intensity === opt.value;
            return (
              <label
                key={opt.value}
                className={`flex cursor-pointer flex-col gap-1 rounded-xl border p-3 text-xs transition-colors duration-150 ${
                  active
                    ? "border-nova-primary bg-nova-primary/10 text-white"
                    : "border-nova-border bg-nova-surface text-nova-muted hover:border-nova-primary/40"
                }`}
              >
                <span className="flex items-center gap-2 font-medium">
                  <input
                    type="radio"
                    name="intensity"
                    value={opt.value}
                    checked={active}
                    onChange={() => setIntensity(opt.value)}
                    className="h-3.5 w-3.5 accent-nova-primary"
                  />
                  {opt.label}
                </span>
                <span className="text-[11px] text-nova-muted">{opt.hint}</span>
              </label>
            );
          })}
        </div>
      </section>

      {error && (
        <div className="rounded-xl border border-nova-urgent/40 bg-nova-urgent/10 p-3 text-sm text-nova-urgent">
          {error}
        </div>
      )}

      <div className="flex justify-end gap-3 pb-4">
        <button
          type="button"
          onClick={() => router.back()}
          className="nova-btn-secondary"
          disabled={submitting}
        >
          Cancel
        </button>
        <button type="submit" className="nova-btn-primary" disabled={submitting}>
          {submitting ? "Creating…" : "Create Reminder"}
        </button>
      </div>
    </form>
  );
}
