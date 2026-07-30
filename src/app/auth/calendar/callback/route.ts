// Возврат с экрана согласия на чтение календаря.
//
// Отличие от входа (`/auth/callback`) принципиальное: сессию здесь не выдают.
// Подключение привязывается к пользователю, который УЖЕ вошёл, — иначе выбранный
// на экране Google аккаунт мог бы подменить собой сессию.

import { NextResponse, type NextRequest } from "next/server";
import {
  CALENDAR_OAUTH_COOKIE,
  calendarCallbackUrl,
  type CalendarOAuthState,
} from "@/lib/auth/calendar-oauth";
import { appOrigin, safeNextPath } from "@/lib/auth/oauth-state";
import { connectGoogleAccount, syncAccount } from "@/lib/core/calendars";
import { getCoreUser } from "@/lib/core/context";
import { exchangeCalendarCode } from "@/lib/core/google-calendar";
import { todayIso } from "@/lib/core/views";

const SETTINGS = "/v2/settings/calendars";

function back(request: NextRequest, next: string, query: string): NextResponse {
  const response = NextResponse.redirect(`${appOrigin(request)}${safeNextPath(next)}${query}`);
  response.cookies.delete(CALENDAR_OAUTH_COOKIE);
  return response;
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const stored = request.cookies.get(CALENDAR_OAUTH_COOKIE)?.value;

  let saved: CalendarOAuthState | null = null;
  try {
    saved = stored ? (JSON.parse(stored) as CalendarOAuthState) : null;
  } catch {
    saved = null;
  }
  const next = saved?.next ?? SETTINGS;

  // Человек нажал «Отмена» на экране Google — это не ошибка, а решение.
  if (searchParams.get("error")) return back(request, next, "?error=denied");

  const code = searchParams.get("code");
  const state = searchParams.get("state");
  if (!code || !state || !saved) return back(request, next, "?error=oauth");
  // Ответ Google должен относиться к потоку, начатому в этом же браузере.
  if (saved.state !== state) return back(request, next, "?error=state");

  const user = await getCoreUser();
  if (!user) return NextResponse.redirect(`${appOrigin(request)}/login`);

  try {
    const grant = await exchangeCalendarCode({
      code,
      redirectUri: calendarCallbackUrl(request),
      codeVerifier: saved.verifier,
    });
    const accountId = await connectGoogleAccount(user.id, grant);
    // Первая синхронизация сразу: подключение, которое до тика cron выглядит
    // пустым, читается как неработающее. Её отказ подключение не отменяет —
    // причина уже записана в sync_error и видна в настройках.
    await syncAccount(accountId, todayIso());
    return back(request, next, "?connected=1");
  } catch (err) {
    console.error("[calendar] подключение Google не удалось:", err);
    return back(request, next, "?error=exchange");
  }
}
