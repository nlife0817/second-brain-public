const CACHE_NAME = "second-brain-v5";
const OFFLINE_URL = "/offline.html";
const STATIC_ASSETS = [OFFLINE_URL, "/icons/icon-192.png", "/icons/icon-512.png"];

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
  // только статические ассеты. Без сети — своя страница вместо «динозавра»:
  // в установленном приложении браузерная ошибка выглядит как поломка.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(async () => {
        const cached = await caches.match(request);
        if (cached) return cached;
        const offline = await caches.match(OFFLINE_URL);
        return offline || Response.error();
      })
    );
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
    // Тег схлопывает уведомления по одной сущности; renotify возвращает звук и
    // вибрацию, иначе замена происходила бы молча и её легко пропустить.
    renotify: !!data.tag,
    data: { url: data.url || "/", itemId: data.itemId, action: data.action },
    requireInteraction: !!data.requireInteraction,
    actions: Array.isArray(data.actions) ? data.actions.slice(0, 2) : undefined,
  };
  const jobs = [self.registration.showNotification(title, options)];
  // Счётчик на иконке установленного приложения (Android / iOS 16.4+).
  if (typeof data.unread === "number" && "setAppBadge" in self.navigator) {
    jobs.push(
      (data.unread > 0
        ? self.navigator.setAppBadge(data.unread)
        : self.navigator.clearAppBadge()
      ).catch(() => {})
    );
  }
  event.waitUntil(Promise.all(jobs));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(openTarget(event.notification.data?.url || "/"));
});

function isMobileShellPath(pathname) {
  return pathname === "/v2/m" || pathname.startsWith("/v2/m/");
}

/**
 * Открывает адрес уведомления. Если приложение уже запущено — фокусируем его
 * окно и передаём адрес сообщением: client.navigate() перезагружает страницу
 * целиком (потерянный ввод, секунда белого экрана), а мобильная оболочка умеет
 * перейти сама. Промис возвращается наружу — иначе браузер вправе усыпить
 * service worker до того, как окно откроется.
 */
async function openTarget(targetUrl) {
  const url = new URL(targetUrl, self.location.origin);
  const clientList = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  const sameOrigin = clientList.filter((c) => {
    try {
      return new URL(c.url).origin === self.location.origin;
    } catch {
      return false;
    }
  });
  // Предпочитаем окно, уже открытое на v2: там живёт обработчик сообщения.
  const target =
    sameOrigin.find((c) => isMobileShellPath(new URL(c.url).pathname)) ??
    sameOrigin.find((c) => new URL(c.url).pathname.startsWith("/v2")) ??
    sameOrigin[0];

  if (target) {
    await target.focus().catch(() => {});
    if (isMobileShellPath(new URL(target.url).pathname)) {
      target.postMessage({ type: "sb:navigate", url: url.href });
      return;
    }
    if ("navigate" in target) {
      await target.navigate(url.href).catch(() => {});
      return;
    }
  }
  if (self.clients.openWindow) await self.clients.openWindow(url.href);
}
