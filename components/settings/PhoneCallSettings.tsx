"use client";

import { useEffect, useState } from "react";
import { validatePhoneNumber } from "@/lib/notifications/validatePhoneNumber";

interface PhoneCallSettingsProps {
  initialPhoneNumber: string | null;
}

type CallResult = { ok: boolean; detail: string } | null;

export function PhoneCallSettings({ initialPhoneNumber }: PhoneCallSettingsProps) {
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [phoneNumber, setPhoneNumber] = useState(initialPhoneNumber ?? "");
  const [saved, setSaved] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [callResult, setCallResult] = useState<CallResult>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/twilio/status-check")
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled) setConfigured(Boolean(d.configured));
      })
      .catch(() => {
        if (!cancelled) setConfigured(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const validation = validatePhoneNumber(phoneNumber || null);

  async function savePhoneNumber() {
    setSaving(true);
    setSaved(null);
    try {
      const res = await fetch("/api/preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone_number: phoneNumber || null }),
      });
      setSaved(res.ok ? "Saved." : "Failed to save.");
    } catch {
      setSaved("Failed to save.");
    } finally {
      setSaving(false);
    }
  }

  async function confirmTestCall() {
    setBusy(true);
    setCallResult(null);
    try {
      const res = await fetch("/api/twilio/test-call", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: true, phoneNumber }),
      });
      const data = await res.json();
      setCallResult({ ok: Boolean(data.ok), detail: data.detail ?? data.reason ?? "Unknown result." });
    } catch (err) {
      setCallResult({ ok: false, detail: err instanceof Error ? err.message : "Request failed." });
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  }

  const testDisabled = configured !== true || !validation.valid || busy;

  return (
    <div className="nova-card p-5">
      <h3 className="mb-4 text-sm font-semibold text-white">Phone Calls</h3>

      <div className="mb-4 flex items-center gap-2 text-sm">
        {configured === null ? (
          <span className="text-nova-muted">Checking…</span>
        ) : configured ? (
          <span className="text-nova-good">● Configured</span>
        ) : (
          <span className="text-nova-muted">○ Not configured — add Twilio credentials to .env.local</span>
        )}
      </div>

      <label className="mb-1 block text-xs text-nova-muted" htmlFor="phone-number">
        Your phone number (used for call/SMS escalation)
      </label>
      <input
        id="phone-number"
        type="tel"
        value={phoneNumber}
        onChange={(e) => setPhoneNumber(e.target.value)}
        placeholder="+919876543210"
        className="mb-1 w-full rounded-xl border border-nova-border bg-nova-surface2 px-3 py-2 text-sm text-white outline-none focus:border-nova-accent"
      />
      {phoneNumber && !validation.valid && (
        <p className="mb-3 text-xs text-nova-primary">{validation.reason}</p>
      )}
      {(!phoneNumber || validation.valid) && (
        <p className="mb-3 text-xs text-nova-muted">
          E.164 format required, e.g. +919876543210. This is the number NOVA calls or texts when a
          reminder escalates — separate from any contact info on a &quot;Call&quot; reminder.
        </p>
      )}

      <div className="mb-4 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={saving || (Boolean(phoneNumber) && !validation.valid)}
          onClick={savePhoneNumber}
          className="rounded-xl border border-nova-border px-4 py-2 text-sm font-medium text-white transition-colors hover:border-nova-accent disabled:opacity-50"
        >
          Save Number
        </button>
        {saved && <span className="self-center text-xs text-nova-muted">{saved}</span>}
      </div>

      {!confirming ? (
        <button
          type="button"
          disabled={testDisabled}
          onClick={() => setConfirming(true)}
          className="rounded-xl bg-nova-primary px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          title={configured !== true ? "Phone calling is not configured yet." : undefined}
        >
          Send Test Call
        </button>
      ) : (
        <div className="rounded-xl border border-nova-border p-3">
          <p className="mb-3 text-sm text-white">Call {phoneNumber}?</p>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={confirmTestCall}
              className="rounded-xl bg-nova-primary px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              Confirm Test Call
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setConfirming(false)}
              className="rounded-xl border border-nova-border px-4 py-2 text-sm font-medium text-white transition-colors hover:border-nova-accent disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {configured !== true && (
        <p className="mt-3 text-xs text-nova-muted">Phone calling is not configured yet.</p>
      )}

      {callResult && (
        <p className={`mt-3 text-xs ${callResult.ok ? "text-nova-good" : "text-nova-primary"}`}>
          {callResult.detail}
        </p>
      )}
    </div>
  );
}
