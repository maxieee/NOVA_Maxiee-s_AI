// NOVA service worker: minimal install/cache for PWA installability, plus
// real Web Push handling. Plain ES2017 JS — no bundler transform expected,
// served as a static file at /sw.js.

const CACHE_NAME = "nova-shell-v1";
const SHELL_ASSETS = ["/", "/manifest.webmanifest", "/icon-192.png", "/icon-512.png"];

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(SHELL_ASSETS).catch(() => undefined))
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Network-first for navigation, minimal cache fallback otherwise — this is
// not an offline-first app, just enough for installability.
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  );
});

self.addEventListener("push", (event) => {
  let data = { title: "NOVA", body: "You have a reminder.", data: {}, actions: [] };
  if (event.data) {
    try {
      data = JSON.parse(event.data.text());
    } catch {
      data = { title: "NOVA", body: event.data.text(), data: {}, actions: [] };
    }
  }

  const options = {
    body: data.body,
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    data: data.data || {},
    actions: Array.isArray(data.actions) ? data.actions : [],
  };

  event.waitUntil(self.registration.showNotification(data.title || "NOVA", options));
});

self.addEventListener("notificationclick", (event) => {
  const notification = event.notification;
  const reminderId = notification.data && notification.data.reminderId;
  const url = (notification.data && notification.data.url) || "/";
  notification.close();

  event.waitUntil(
    (async () => {
      // Handle action buttons where the platform supports them. If the
      // fetch fails, we do not claim it succeeded — we just fall back to
      // opening the page so the person can act manually.
      if (event.action === "done" && reminderId) {
        try {
          const res = await fetch(`/api/reminders/${reminderId}/done`, { method: "POST" });
          if (!res.ok) throw new Error("done request failed");
          return; // acted successfully, no need to open a window
        } catch {
          // fall through to opening the page
        }
      } else if (event.action === "snooze" && reminderId) {
        try {
          const res = await fetch(`/api/reminders/${reminderId}/snooze`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ minutes: 15 }),
          });
          if (!res.ok) throw new Error("snooze request failed");
          return;
        } catch {
          // fall through to opening the page
        }
      }

      // Default: focus an existing NOVA window on this URL, or open one.
      const allClients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of allClients) {
        if ("focus" in client) {
          client.navigate(url).catch(() => undefined);
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(url);
      }
    })()
  );
});
