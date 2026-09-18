"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Minimal single-user "login": one password-style field for
 * APP_ACCESS_TOKEN, submitted to POST /api/auth/login (itself the one
 * unauthenticated exception besides cron/OAuth-callback). On success the
 * server sets an httpOnly session cookie and every subsequent same-origin
 * fetch — from this app's client components and from the service worker's
 * notification-action calls — is authenticated automatically.
 */
export default function LoginPage() {
  const router = useRouter();
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      if (!res.ok) {
        setError("Incorrect access token.");
        return;
      }
      router.replace("/");
      router.refresh();
    } catch {
      setError("Something went wrong. Try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-nova-bg px-4">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm rounded-2xl border border-white/10 bg-white/5 p-6"
      >
        <h1 className="mb-1 text-lg font-semibold text-white">NOVA</h1>
        <p className="mb-4 text-sm text-white/60">Enter your access token to continue.</p>
        <input
          type="password"
          autoFocus
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="Access token"
          className="mb-3 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-white outline-none"
        />
        {error && <p className="mb-3 text-sm text-red-400">{error}</p>}
        <button
          type="submit"
          disabled={loading || !token}
          className="w-full rounded-lg bg-white/90 px-3 py-2 font-medium text-black disabled:opacity-50"
        >
          {loading ? "Checking..." : "Continue"}
        </button>
      </form>
    </div>
  );
}
