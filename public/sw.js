const CACHE_NAME = "second-brain-v2";
const STATIC_ASSETS = ["/icons/icon-192.png", "/icons/icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET and API/data requests
  if (request.method !== "GET") return;
  if (url.pathname.startsWith("/api/")) return;
  if (url.pathname.startsWith("/_next/")) return;

  // Navigation requests (HTML documents) — always network-first.
  // Cached HTML после деплоя приводит к рассинхрону bundle и UI; в кеш кладём
  // только статические ассеты. При offline отдаём fallback из кеша если есть.
  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(() => caches.match(request)));
    return;
  }

  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok && url.pathname.match(/\.(js|css|png|svg|woff2?)$/)) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        }
        return response;
      })
      .catch(() => caches.match(request))
  );
});

// ---- Web Push ----

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "Second Brain", body: event.data ? event.data.text() : "" };
  }
  const title = data.title || "Second Brain";
  const options = {
    body: data.body || "",
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
    tag: data.tag,
    data: { url: data.url || "/", itemId: data.itemId },
    requireInteraction: !!data.requireInteraction,
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || "/";
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clientList) => {
        // If app is already open in a tab — focus it and navigate.
        for (const client of clientList) {
          if ("focus" in client) {
            client.focus();
            if ("navigate" in client) client.navigate(targetUrl).catch(() => {});
            return;
          }
        }
        // Otherwise open a new tab.
        if (self.clients.openWindow) {
          return self.clients.openWindow(targetUrl);
        }
      })
  );
});
