/* AN Maintenance — Push Service Worker */
/* eslint-disable no-restricted-globals */

const CACHE_VERSION = "an-maint-v1";

self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "AN Maintenance", body: event.data ? event.data.text() : "" };
  }

  const title = data.title || "AN Maintenance";
  const options = {
    body: data.body || "",
    icon: data.icon || "/favicon.ico",
    badge: data.badge || "/favicon.ico",
    image: data.image || undefined,
    tag: data.tag || "an-maint",
    data: {
      url: data.url || "/",
      woId: data.woId || null,
    },
    actions: [
      { action: "open", title: "Open WO" },
      { action: "dismiss", title: "Dismiss" },
    ],
    requireInteraction: !!data.requireInteraction,
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  if (event.action === "dismiss") return;

  const targetUrl =
    (event.notification.data && event.notification.data.url) || "/";

  event.waitUntil(
    (async () => {
      const allClients = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      for (const client of allClients) {
        if ("focus" in client) {
          await client.focus();
          if ("navigate" in client) {
            try {
              await client.navigate(targetUrl);
            } catch {}
          }
          return;
        }
      }
      if (self.clients.openWindow) {
        await self.clients.openWindow(targetUrl);
      }
    })()
  );
});

/* Chrome will not fire `beforeinstallprompt` for a service worker with no fetch
   listener, so without this the app can never be installed to a home screen.
   Deliberately does NOT call event.respondWith and does NOT cache: this runs a
   factory floor, where a stale cached response is worse than no PWA at all. */
self.addEventListener("fetch", () => {});
