// Промежуточное состояние входа: живёт между редиректом на Google и возвратом.

import type { NextRequest } from "next/server";

export const OAUTH_COOKIE = "sb_oauth";

/** Десять минут — сколько разумно занимает выбор аккаунта на стороне Google. */
const OAUTH_TTL_SECONDS = 600;

export interface OAuthState {
  /** Сверяется с параметром state из ответа Google — защита от login CSRF. */
  state: string;
  /** PKCE-верификатор, уходит в token endpoint. */
  verifier: string;
  /** Куда вернуть пользователя после входа. */
  next: string;
}

export function oauthCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: OAUTH_TTL_SECONDS,
  };
}

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
 * За обратным прокси Host в запросе — внутреннее имя контейнера, а redirect_uri
 * обязан посимвольно совпадать с зарегистрированным в Google Cloud Console.
 * Поэтому источник правды — переменная окружения, а origin запроса остаётся
 * запасным вариантом для локального `npm run dev`.
 */
export function appOrigin(request: NextRequest): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (configured) return configured.replace(/\/+$/, "");
  return request.nextUrl.origin;
}

export function callbackUrl(request: NextRequest): string {
  return `${appOrigin(request)}/auth/callback`;
}
