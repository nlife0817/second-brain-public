// Сессия без Supabase Auth: подписанная HMAC-SHA256 cookie.
//
// Раньше сессию держал GoTrue, а проверял её @supabase/ssr (ES256 + JWKS,
// см. историю lib/supabase/claims.ts). После переезда на свой VPS внешнего
// сервиса нет: приложение само обменивает код Google на профиль и само
// подписывает cookie.
//
// Требование к реализации — работать в обоих рантаймах: proxy исполняется на
// Edge (нет node:crypto), роуты и серверные компоненты — в Node. Поэтому
// только WebCrypto, доступный в обоих.
//
// Безопасность: cookie подписана, но не зашифрована — внутрь кладём только то,
// что и так известно владельцу браузера (email, имя, Google sub). Права по этим
// данным не выдаются: и v1 (whitelist в public.users), и v2 (core.org_members)
// проверяют доступ отдельным запросом к базе на каждый запрос — заблокированный
// аккаунт теряет доступ сразу, не дожидаясь истечения cookie.

import { fromBase64Url, toBase64Url, utf8ToBase64Url, base64UrlToUtf8 } from "./base64url";

export const SESSION_COOKIE = "sb_session";

/** 30 дней: как у прежних сессий Supabase с refresh-токеном. */
const MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

export interface SessionUser {
  /** Google `sub` — стабилен при смене email, в отличие от самого email. */
  id: string;
  email: string;
  fullName: string;
}

export interface SessionPayload extends SessionUser {
  /** Unix-время истечения, секунды. */
  exp: number;
}

let keyPromise: Promise<CryptoKey> | null = null;

function getKey(): Promise<CryptoKey> {
  if (!keyPromise) {
    const secret = process.env.SESSION_SECRET;
    if (!secret) throw new Error("SESSION_SECRET is not set");
    keyPromise = crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign", "verify"],
    );
  }
  return keyPromise;
}

/** Подписанное значение cookie для пользователя. */
export async function signSession(user: SessionUser): Promise<string> {
  const payload: SessionPayload = {
    ...user,
    exp: Math.floor(Date.now() / 1000) + MAX_AGE_SECONDS,
  };
  const body = utf8ToBase64Url(JSON.stringify(payload));
  const signature = await crypto.subtle.sign(
    "HMAC",
    await getKey(),
    new TextEncoder().encode(body),
  );
  return `${body}.${toBase64Url(new Uint8Array(signature))}`;
}

/** Разобранная и проверенная нагрузка cookie или null. */
export async function verifySessionPayload(
  value: string | undefined,
): Promise<SessionPayload | null> {
  if (!value) return null;
  const separator = value.lastIndexOf(".");
  if (separator <= 0) return null;

  const body = value.slice(0, separator);
  const signature = value.slice(separator + 1);

  try {
    // crypto.subtle.verify сравнивает за постоянное время — вручную подписи
    // сверять нельзя, иначе появляется тайминговый оракул.
    const valid = await crypto.subtle.verify(
      "HMAC",
      await getKey(),
      fromBase64Url(signature),
      new TextEncoder().encode(body),
    );
    if (!valid) return null;

    const payload = JSON.parse(base64UrlToUtf8(body)) as SessionPayload;
    if (typeof payload?.exp !== "number" || payload.exp * 1000 <= Date.now()) return null;
    if (!payload.email) return null;

    return {
      id: String(payload.id ?? ""),
      email: payload.email,
      fullName: payload.fullName ?? "",
      exp: payload.exp,
    };
  } catch {
    // Повреждённое значение — обычная ситуация после смены SESSION_SECRET.
    return null;
  }
}

/** Профиль без служебного exp — то, что подписывается заново при продлении. */
export function toSessionUser(payload: SessionPayload): SessionUser {
  return { id: payload.id, email: payload.email, fullName: payload.fullName };
}

/** Пользователь из значения cookie или null (битая подпись, истёкший срок). */
export async function verifySession(value: string | undefined): Promise<SessionUser | null> {
  const payload = await verifySessionPayload(value);
  return payload ? toSessionUser(payload) : null;
}

/**
 * Пора ли продлить cookie. Без продления активный пользователь ровно через
 * 30 дней оказывался бы на экране входа посреди работы; переподписываем,
 * когда истекла две трети срока — так запись в cookie происходит редко.
 */
export function shouldRenew(payload: SessionPayload): boolean {
  const remaining = payload.exp - Math.floor(Date.now() / 1000);
  return remaining < MAX_AGE_SECONDS / 3;
}

/**
 * Параметры установки cookie сессии.
 *
 * sameSite: "lax" обязателен — после возврата с accounts.google.com браузер
 * должен приложить cookie к навигационному GET; при "strict" пользователь
 * приезжал бы на главную уже разлогиненным.
 */
export function sessionCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: MAX_AGE_SECONDS,
  };
}

/**
 * Текущий пользователь в серверном компоненте или роуте (рантайм Node).
 * В proxy используйте verifySession поверх request.cookies — там `cookies()`
 * из next/headers недоступен.
 */
export async function getSessionUser(): Promise<SessionUser | null> {
  const { cookies } = await import("next/headers");
  const store = await cookies();
  return verifySession(store.get(SESSION_COOKIE)?.value);
}
