"use client";

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const normalized = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = typeof window !== "undefined" ? window.atob(normalized) : "";
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export type PushState =
  | { supported: false; reason: string }
  | { supported: true; permission: NotificationPermission; subscribed: boolean };

export async function getPushState(): Promise<PushState> {
  if (typeof window === "undefined") return { supported: false, reason: "SSR" };
  if (!("serviceWorker" in navigator)) return { supported: false, reason: "No service worker" };
  if (!("PushManager" in window)) return { supported: false, reason: "No Push API" };
  if (!("Notification" in window)) return { supported: false, reason: "No Notification API" };

  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  return {
    supported: true,
    permission: Notification.permission,
    subscribed: !!sub,
  };
}

/** Куда сохранять подписку. Приёмник один — /api/v2/push/subscribe. */
export type PushClientOptions = { subscribeUrl?: string };

const DEFAULT_SUBSCRIBE_URL = "/api/v2/push/subscribe";

export async function enablePushNotifications(opts?: PushClientOptions): Promise<void> {
  const subscribeUrl = opts?.subscribeUrl ?? DEFAULT_SUBSCRIBE_URL;
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    throw new Error("Push API не поддерживается браузером");
  }
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  if (!publicKey) {
    throw new Error(
      "NEXT_PUBLIC_VAPID_PUBLIC_KEY не определён в build. Добавь переменную в deploy/.env и пересобери образ."
    );
  }

  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    throw new Error("Разрешение на уведомления не получено");
  }

  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey).buffer as ArrayBuffer,
    });
  }

  const json = sub.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
  const res = await fetch(subscribeUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      endpoint: json.endpoint,
      keys: { p256dh: json.keys?.p256dh, auth: json.keys?.auth },
    }),
  });
  if (!res.ok) {
    const { error } = await res.json().catch(() => ({ error: "subscribe failed" }));
    throw new Error(error);
  }
}

/**
 * Просит service worker убрать из шторки прочитанное и поправить бейдж.
 * Без тега закрывает все уведомления приложения — это случай «непрочитанных
 * не осталось», в том числе когда их разобрали на другом устройстве: сюда
 * приложение приходит, увидев обнулившийся счётчик.
 *
 * Сообщение уходит контроллеру страницы; если его ещё нет, то и уведомлений
 * этого браузера в шторке нет.
 */
export function syncReadState(state: { tag?: string; unread?: number }): void {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  navigator.serviceWorker.controller?.postMessage({ type: "sb:read", ...state });
}

export async function disablePushNotifications(opts?: PushClientOptions): Promise<void> {
  const subscribeUrl = opts?.subscribeUrl ?? DEFAULT_SUBSCRIBE_URL;
  if (!("serviceWorker" in navigator)) return;
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (!sub) return;
  const endpoint = sub.endpoint;
  await sub.unsubscribe();
  await fetch(`${subscribeUrl}?endpoint=${encodeURIComponent(endpoint)}`, {
    method: "DELETE",
  });
}
