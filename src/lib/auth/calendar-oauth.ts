// Промежуточное состояние отдельного согласия на чтение календаря.
//
// Своя cookie, а не общая с входом (`sb_oauth`): заходы независимы, и человек,
// начавший подключение календаря в одной вкладке и вход в другой, не должен
// ломать ни то, ни другое.

import type { NextRequest } from "next/server";
import { appOrigin } from "./oauth-state";

export const CALENDAR_OAUTH_COOKIE = "sb_cal_oauth";

/** Десять минут — сколько разумно занимает согласие на экране Google. */
const TTL_SECONDS = 600;

export interface CalendarOAuthState {
  state: string;
  verifier: string;
  /** Куда вернуть человека: экран настроек, откуда он начал. */
  next: string;
}

export function calendarOAuthCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: TTL_SECONDS,
  };
}

/**
 * Адрес возврата. Отдельный от входа (`/auth/callback`), потому что обработка
 * разная — и потому что его надо отдельной строкой зарегистрировать в Google
 * Cloud Console: redirect_uri сверяется посимвольно.
 */
export function calendarCallbackUrl(request: NextRequest): string {
  return `${appOrigin(request)}/auth/calendar/callback`;
}
