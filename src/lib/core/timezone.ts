"use client";

// Часовой пояс устройства для сервера.
//
// Сроки задач хранятся без зоны, поэтому «сегодня» и «18:00» существуют только
// в поясе получателя: без него утренняя сводка и тихие часы срабатывают не
// тогда, когда человек их ждёт. Спрашивать пояс в настройках незачем — браузер
// и телефон знают его сами.

import { api } from "./client";

/** Совпадает с ключом в USER_SCOPED_KEYS: выход стирает отметку. */
const REPORTED_KEY = "sb.v2.tz";

export function browserTimezone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}

/**
 * Сообщает пояс серверу, если он изменился с прошлого раза на этом устройстве.
 * Отметка в localStorage избавляет от запроса на каждый запуск приложения —
 * пояс меняется в лучшем случае в поездке.
 */
export async function reportTimezone(): Promise<void> {
  const tz = browserTimezone();
  if (!tz) return;
  try {
    if (window.localStorage.getItem(REPORTED_KEY) === tz) return;
  } catch {
    // приватный режим — отправим, это дешевле, чем гадать
  }
  try {
    await api.patch("/notifications/settings", { timezone: tz });
    window.localStorage.setItem(REPORTED_KEY, tz);
  } catch {
    // Не критично: сервер продолжит пользоваться прежним поясом.
  }
}
