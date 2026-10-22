/* PMSYSTEM — Push Service Worker */
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
    data = { title: "PMSYSTEM", body: event.data ? event.data.text() : "" };
  }

  const title = data.title || "PMSYSTEM";
  const options = {
    body: data.body || "",
    // These two files exist in /public; send-push used to name /icons/icon-192.png, which
    // does not, so the lock screen showed a blank square.
    icon: data.icon || "/android-chrome-192x192.png",
    badge: data.badge || "/favicon-32x32.png",
    image: data.image || undefined,
    tag: data.tag || "an-maint",
    // send-push nests these under `data` ({ data: { url, wo_id } }); reading only the top
    // level sent every tap to "/".
    data: {
      url: (data.data && data.data.url) || data.url || "/",
      woId: (data.data && data.data.wo_id) || data.woId || null,
    },
    // A new message with the same tag replaces the one on screen instead of stacking, and
    // renotify makes the replacement alert again (a group's later messages share a tag).
    renotify: !!data.tag,
    requireInteraction: !!data.requireInteraction,
  };
  // Buttons only where they mean something: "Open WO" on a chat message was wrong, and iOS
  // draws no action buttons at all.
  if ((data.data && data.data.wo_id) || data.woId) {
    options.actions = [
      { action: "open", title: "Open WO" },
      { action: "dismiss", title: "Dismiss" },
    ];
  }

  event.waitUntil(self.registration.showNotification(title, options));
});

// The push service rotated this phone's subscription (iOS does, now and then). The worker
// cannot save it — only the page has the login — so it subscribes again with the same key
// and tells every open page to save it; a page opened later does the same at start-up
// (useKeepPushSubscriptionCurrent).
self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    (async () => {
      try {
        const key =
          (event.oldSubscription && event.oldSubscription.options && event.oldSubscription.options.applicationServerKey) || null;
        if (key) {
          await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
        }
      } catch {}
      const pages = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const page of pages) page.postMessage({ type: "push-subscription-changed" });
    })()
  );
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
