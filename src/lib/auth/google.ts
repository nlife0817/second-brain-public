// Вход через Google напрямую, без GoTrue: OAuth 2.0 authorization code flow + PKCE.
//
// Клиент confidential (секрет живёт на сервере), поэтому PKCE формально
// необязателен — но он закрывает перехват кода на редиректе и стоит десяти строк.

import { base64UrlToUtf8, randomToken, toBase64Url } from "./base64url";

const AUTHORIZATION_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

/** Издатели, которых Google указывает в id_token. Обе формы легальны. */
const VALID_ISSUERS = new Set(["accounts.google.com", "https://accounts.google.com"]);

export interface GoogleProfile {
  /** Неизменный идентификатор аккаунта Google. */
  sub: string;
  email: string;
  fullName: string;
}

function clientId(): string {
  const value = process.env.GOOGLE_CLIENT_ID;
  if (!value) throw new Error("GOOGLE_CLIENT_ID is not set");
  return value;
}

function clientSecret(): string {
  const value = process.env.GOOGLE_CLIENT_SECRET;
  if (!value) throw new Error("GOOGLE_CLIENT_SECRET is not set");
  return value;
}

export function createCodeVerifier(): string {
  return randomToken(32);
}

export async function createCodeChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return toBase64Url(new Uint8Array(digest));
}

export function buildAuthorizationUrl(input: {
  redirectUri: string;
  state: string;
  codeChallenge: string;
}): string {
  const url = new URL(AUTHORIZATION_ENDPOINT);
  url.searchParams.set("client_id", clientId());
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid email profile");
  url.searchParams.set("state", input.state);
  url.searchParams.set("code_challenge", input.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  // Аккаунт запоминается между входами; выбор появляется только если
  // в браузере их несколько.
  url.searchParams.set("prompt", "select_account");
  return url.toString();
}

interface IdTokenClaims {
  iss?: string;
  aud?: string;
  sub?: string;
  exp?: number;
  email?: string;
  email_verified?: boolean;
  name?: string;
}

/**
 * Разбирает id_token без проверки подписи.
 *
 * Это допустимо ровно в этом месте: токен получен ответом на серверный POST
 * к token endpoint Google по TLS, а не пришёл от браузера (OpenID Connect Core,
 * §3.1.3.7 — при получении напрямую от Token Endpoint подпись можно не
 * проверять). Клеймы всё равно сверяем: aud/iss отсечёт токен, выписанный
 * другому клиенту, если endpoint однажды подменят.
 */
function parseIdToken(idToken: string): IdTokenClaims {
  const parts = idToken.split(".");
  if (parts.length !== 3) throw new Error("id_token: неверный формат");
  return JSON.parse(base64UrlToUtf8(parts[1])) as IdTokenClaims;
}

/** Меняет код авторизации на профиль пользователя. */
export async function exchangeCodeForProfile(input: {
  code: string;
  redirectUri: string;
  codeVerifier: string;
}): Promise<GoogleProfile> {
  const response = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code: input.code,
      client_id: clientId(),
      client_secret: clientSecret(),
      redirect_uri: input.redirectUri,
      grant_type: "authorization_code",
      code_verifier: input.codeVerifier,
    }),
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Google token endpoint ответил ${response.status}: ${detail.slice(0, 200)}`);
  }

  const tokens = (await response.json()) as { id_token?: string };
  if (!tokens.id_token) throw new Error("Google не вернул id_token");

  const claims = parseIdToken(tokens.id_token);

  if (claims.aud !== clientId()) throw new Error("id_token выписан другому клиенту");
  if (!claims.iss || !VALID_ISSUERS.has(claims.iss)) throw new Error("id_token: чужой издатель");
  if (typeof claims.exp !== "number" || claims.exp * 1000 <= Date.now()) {
    throw new Error("id_token истёк");
  }
  if (!claims.sub) throw new Error("id_token без sub");
  if (!claims.email) throw new Error("id_token без email");
  // Пользователь резолвится по email (см. lib/core/context.ts), поэтому
  // неподтверждённый адрес пускать нельзя: иначе чужой аккаунт заявляет
  // произвольный email и получает доступ по чужому приглашению.
  if (claims.email_verified !== true) throw new Error("email в аккаунте Google не подтверждён");

  return {
    sub: claims.sub,
    email: claims.email.toLowerCase().trim(),
    fullName: claims.name ?? "",
  };
}
