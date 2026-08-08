// Начало отдельного согласия на чтение Google Calendar.
//
// Роут проходит проверку сессии в proxy (в `config.matcher` он не исключён), и
// это правильно: подключение привязывается к вошедшему пользователю, а не к тому,
// чей аккаунт выбрали на экране Google.

import { NextResponse, type NextRequest } from "next/server";
import { randomToken } from "@/lib/auth/base64url";
import {
  CALENDAR_OAUTH_COOKIE,
  calendarCallbackUrl,
  calendarOAuthCookieOptions,
  type CalendarOAuthState,
} from "@/lib/auth/calendar-oauth";
import { appOrigin, safeNextPath } from "@/lib/auth/urls";
import { getCoreUser } from "@/lib/core/context";
import {
  buildCalendarAuthUrl,
  createCodeChallenge,
  createCodeVerifier,
} from "@/lib/core/google-calendar";
import { secretsConfigured } from "@/lib/core/secret-box";

const SETTINGS = "/v2/settings/calendars";

export async function GET(request: NextRequest) {
  const user = await getCoreUser();
  if (!user) return NextResponse.redirect(`${appOrigin(request)}/login`);

  // Без ключа шифрования refresh-токен пришлось бы положить открытым текстом —
  // лучше честно отказать до похода на экран Google.
  if (!secretsConfigured()) {
    return NextResponse.redirect(`${appOrigin(request)}${SETTINGS}?error=nokey`);
  }

  const next = safeNextPath(request.nextUrl.searchParams.get("next") ?? SETTINGS);
  const verifier = createCodeVerifier();
  const state = randomToken(16);

  const url = buildCalendarAuthUrl({
    redirectUri: calendarCallbackUrl(request),
    state,
    codeChallenge: await createCodeChallenge(verifier),
    loginHint: user.email,
  });

  const payload: CalendarOAuthState = { state, verifier, next };
  const response = NextResponse.redirect(url);
  response.cookies.set(CALENDAR_OAUTH_COOKIE, JSON.stringify(payload), calendarOAuthCookieOptions());
  return response;
}
