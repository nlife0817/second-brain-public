"use client";

// Выход из аккаунта на стороне браузера.
//
// Cookie сессии снимает /api/auth/logout — роут написан вместе со своей
// сессией, но до сих пор его никто не звал: кнопки выхода в интерфейсе не
// существовало.
//
// Порядок шагов важен: отписка устройства требует живой сессии, поэтому идёт
// до снятия cookie. Дальше — жёсткий переход на /login, а не router.push:
// zustand-стор, кэш роутера и открытые карточки не должны пережить смену
// пользователя.

import { disablePushNotifications } from "@/lib/notifications/client";

const V2_PUSH = { subscribeUrl: "/api/v2/push/subscribe" };

/** Ключи localStorage, привязанные к конкретному человеку. */
const USER_SCOPED_KEYS = ["sb.v2.orgId"];

export async function signOut(): Promise<void> {
  // Устройство может быть общим: оставленная подписка продолжила бы приносить
  // чужие задачи в шторку до следующего входа.
  try {
    await disablePushNotifications(V2_PUSH);
  } catch {
    // Разрешение отозвано, service worker недоступен — не повод не выйти.
  }

  try {
    await fetch("/api/auth/logout", { method: "POST" });
  } catch {
    // Оффлайн: cookie останется до возвращения сети. Уводим на /login всё
    // равно — иначе кнопка выглядит сломанной.
  }

  try {
    for (const key of USER_SCOPED_KEYS) window.localStorage.removeItem(key);
  } catch {
    // приватный режим
  }

  window.location.href = "/login?signedout=1";
}
