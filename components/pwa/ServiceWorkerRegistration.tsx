"use client";

import { useEffect } from "react";

/** Registers the plain-JS service worker at /sw.js. No-op if unsupported. */
export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // Registration failures (e.g. unsupported browser, blocked in a
      // private context) are silent — the rest of the app must not assume
      // push/PWA support is available.
    });
  }, []);

  return null;
}
