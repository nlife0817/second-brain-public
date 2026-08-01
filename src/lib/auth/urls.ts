// Адреса приложения: канонический origin и безопасный путь возврата.
//
// Раньше эти две функции жили в `oauth-state.ts` вместе с состоянием входа
// через Google. Вход теперь по паролю, а помощники остались нужны и ему,
// и подключению внешних календарей — единственному месту, где OAuth ещё есть.

import type { NextRequest } from "next/server";

/**
 * Путь для возврата после входа, очищенный от попыток открытого редиректа.
 *
 * Отсекаем всё, что браузер может прочитать как абсолютный адрес: "//evil.com"
 * в new URL(next, origin) превращается в чужой origin, а обратный слэш
 * нормализуется в прямой ещё до разбора.
 */
export function safeNextPath(value: string | null | undefined): string {
  if (!value) return "/";
  if (!value.startsWith("/")) return "/";
  if (value.startsWith("//")) return "/";
  if (value.includes("\\")) return "/";
  return value;
}

/**
 * Канонический адрес приложения.
 *
 * За обратным прокси Host в запросе — внутреннее имя контейнера, поэтому
 * источник правды — переменная окружения. Для подключения календарей это ещё и
 * обязательное условие: redirect_uri обязан посимвольно совпадать с
 * зарегистрированным в Google Cloud Console. Origin запроса остаётся запасным
 * вариантом для локального `npm run dev`.
 */
export function appOrigin(request: NextRequest): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (configured) return configured.replace(/\/+$/, "");
  return request.nextUrl.origin;
}
