// Возврат с экрана Google: сверяет state, меняет код на профиль и выдаёт
// собственную cookie сессии. Раньше здесь работал exchangeCodeForSession
// из @supabase/ssr — теперь обмен идёт напрямую с Google.

import { NextResponse, type NextRequest } from "next/server";
import { exchangeCodeForProfile } from "@/lib/auth/google";
import {
  OAUTH_COOKIE,
  callbackUrl,
  appOrigin,
  safeNextPath,
  type OAuthState,
} from "@/lib/auth/oauth-state";
import { SESSION_COOKIE, sessionCookieOptions, signSession } from "@/lib/auth/session";

function loginError(request: NextRequest, reason: string): NextResponse {
  const response = NextResponse.redirect(`${appOrigin(request)}/login?error=${reason}`);
  response.cookies.delete(OAUTH_COOKIE);
  return response;
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;

  // Пользователь нажал «Отмена» на экране Google.
  if (searchParams.get("error")) return loginError(request, "denied");

  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const stored = request.cookies.get(OAUTH_COOKIE)?.value;
  if (!code || !state || !stored) return loginError(request, "oauth");

  let saved: OAuthState;
  try {
    saved = JSON.parse(stored) as OAuthState;
  } catch {
    return loginError(request, "oauth");
  }

  // Ответ Google должен относиться к потоку, начатому в этом же браузере,
  // иначе злоумышленник может подсунуть свой код авторизации.
  if (!saved.state || saved.state !== state) return loginError(request, "state");

  try {
    const profile = await exchangeCodeForProfile({
      code,
      redirectUri: callbackUrl(request),
      codeVerifier: saved.verifier,
    });

    const session = await signSession({
      id: profile.sub,
      email: profile.email,
      fullName: profile.fullName,
    });

    const target = `${appOrigin(request)}${safeNextPath(saved.next)}`;
    const response = NextResponse.redirect(target);
    response.cookies.set(SESSION_COOKIE, session, sessionCookieOptions());
    response.cookies.delete(OAUTH_COOKIE);
    return response;
  } catch (err) {
    console.error("[auth] обмен кода Google не удался:", err);
    return loginError(request, "oauth");
  }
}
