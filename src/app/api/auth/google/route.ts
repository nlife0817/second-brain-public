// Начало входа: генерирует state и PKCE-пару, кладёт их в короткоживущую
// cookie и отправляет пользователя на экран Google.

import { NextResponse, type NextRequest } from "next/server";
import { randomToken } from "@/lib/auth/base64url";
import {
  buildAuthorizationUrl,
  createCodeChallenge,
  createCodeVerifier,
} from "@/lib/auth/google";
import {
  OAUTH_COOKIE,
  callbackUrl,
  oauthCookieOptions,
  safeNextPath,
  type OAuthState,
} from "@/lib/auth/oauth-state";

export async function GET(request: NextRequest) {
  const next = safeNextPath(request.nextUrl.searchParams.get("next"));
  const verifier = createCodeVerifier();
  const state = randomToken(16);

  const url = buildAuthorizationUrl({
    redirectUri: callbackUrl(request),
    state,
    codeChallenge: await createCodeChallenge(verifier),
  });

  const payload: OAuthState = { state, verifier, next };
  const response = NextResponse.redirect(url);
  response.cookies.set(OAUTH_COOKIE, JSON.stringify(payload), oauthCookieOptions());
  return response;
}
