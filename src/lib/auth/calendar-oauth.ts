// Промежуточное состояние согласия на чтение календаря.
//
// Единственное место, где в приложении остался OAuth: вход давно переведён на
// email с паролем, а подключение внешнего календаря без согласия у Google
// невозможно по определению.

import type { NextRequest } from "next/server";
import { appOrigin } from "./urls";

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
 * Адрес возврата. Его надо отдельной строкой зарегистрировать в Google Cloud
 * Console: redirect_uri сверяется посимвольно.
 */
export function calendarCallbackUrl(request: NextRequest): string {
  return `${appOrigin(request)}/auth/calendar/callback`;
}
