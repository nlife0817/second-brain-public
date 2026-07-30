// Google Calendar API: отдельный OAuth-заход за правом читать календарь и две
// выборки — список календарей и события окна.
//
// Почему отдельный заход, а не расширение входа: вход просит `openid email
// profile` (lib/auth/google.ts) и обходится без refresh-токена — сессия у нас
// своя. Календарю нужен и другой скоуп, и `access_type=offline`, то есть
// согласие, которое человек даёт осознанно и отдельно от «войти». Смешивать их
// нельзя ещё и потому, что расширенное согласие на экране входа отпугивает: за
// правом читать календарь приходят не в момент первого входа.
//
// Что нужно сделать в Google Cloud Console (кодом не закрывается):
//   1. включить Google Calendar API в проекте;
//   2. добавить скоуп `.../auth/calendar.readonly` на экран согласия;
//   3. зарегистрировать второй redirect URI — `<APP_URL>/auth/calendar/callback`.
//
// Инкрементальной синхронизации (`syncToken`) здесь нет намеренно: он
// несовместим с `timeMin`/`timeMax`, а без окна `singleEvents=true` разворачивает
// повторы за всю историю календаря. Подробности — в миграции 0046 и в
// `calendars.ts`.

import { toBase64Url } from "@/lib/auth/base64url";

const AUTHORIZATION_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const CALENDAR_API = "https://www.googleapis.com/calendar/v3";

/** Только чтение: события внешнего календаря задачами не становятся и правке не подлежат. */
const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.readonly";

/** Одна страница выдачи. Больше 2500 Google всё равно не отдаёт. */
const PAGE_SIZE = 250;
/** Предохранитель от бесконечной пагинации на испорченном `nextPageToken`. */
const MAX_PAGES = 20;

const HTTP_TIMEOUT_MS = 15_000;

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
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return toBase64Url(bytes);
}

export async function createCodeChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return toBase64Url(new Uint8Array(digest));
}

/**
 * Адрес согласия.
 *
 * `access_type=offline` + `prompt=consent` — единственный способ гарантированно
 * получить refresh-токен: без `prompt=consent` Google отдаёт его лишь при самом
 * первом согласии, и переподключение календаря после отзыва доступа приходило бы
 * без токена, то есть молча ломалось. `include_granted_scopes` сохраняет ранее
 * выданные права, чтобы этот заход не отобрал их у входа.
 */
export function buildCalendarAuthUrl(input: {
  redirectUri: string;
  state: string;
  codeChallenge: string;
  /** Подсказка, каким аккаунтом подключаться: обычно email вошедшего. */
  loginHint?: string | null;
}): string {
  const url = new URL(AUTHORIZATION_ENDPOINT);
  url.searchParams.set("client_id", clientId());
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", `openid email ${CALENDAR_SCOPE}`);
  url.searchParams.set("state", input.state);
  url.searchParams.set("code_challenge", input.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("include_granted_scopes", "true");
  if (input.loginHint) url.searchParams.set("login_hint", input.loginHint);
  return url.toString();
}

async function postToken(body: Record<string, string>): Promise<Record<string, unknown>> {
  const response = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
    signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Google token endpoint ответил ${response.status}: ${text.slice(0, 200)}`);
  }
  return JSON.parse(text) as Record<string, unknown>;
}

export interface CalendarGrant {
  refreshToken: string;
  accessToken: string;
  /** Аккаунт, который дал согласие: он же подпись подключения в списке. */
  email: string;
  /** Неизменный id аккаунта Google — по нему опознаётся повторное подключение. */
  sub: string;
}

/** Код согласия → токены. id_token разбираем только ради email и sub. */
export async function exchangeCalendarCode(input: {
  code: string;
  redirectUri: string;
  codeVerifier: string;
}): Promise<CalendarGrant> {
  const tokens = await postToken({
    code: input.code,
    client_id: clientId(),
    client_secret: clientSecret(),
    redirect_uri: input.redirectUri,
    grant_type: "authorization_code",
    code_verifier: input.codeVerifier,
  });

  const refreshToken = typeof tokens.refresh_token === "string" ? tokens.refresh_token : "";
  const accessToken = typeof tokens.access_token === "string" ? tokens.access_token : "";
  if (!refreshToken) {
    // Бывает, когда согласие уже выдано, а `prompt=consent` не дошёл: без
    // refresh-токена подключение проживёт час и умрёт, поэтому это ошибка.
    throw new Error("Google не вернул refresh_token — переподключите календарь заново");
  }
  if (!accessToken) throw new Error("Google не вернул access_token");

  const scope = typeof tokens.scope === "string" ? tokens.scope : "";
  if (!scope.includes(CALENDAR_SCOPE)) {
    throw new Error("Доступ к календарю не выдан: на экране Google нужно оставить галочку");
  }

  const idToken = typeof tokens.id_token === "string" ? tokens.id_token : "";
  const claims = idToken ? parseIdTokenClaims(idToken) : {};
  return {
    refreshToken,
    accessToken,
    email: typeof claims.email === "string" ? claims.email.toLowerCase() : "",
    sub: typeof claims.sub === "string" ? claims.sub : "",
  };
}

/**
 * Клеймы id_token без проверки подписи — допустимо здесь по той же причине, что
 * и во входе (lib/auth/google.ts): токен получен серверным POST к endpoint
 * Google по TLS, а не пришёл от браузера. Права он не решает: подключение уже
 * привязано к вошедшему пользователю, отсюда берётся только подпись в списке.
 */
function parseIdTokenClaims(idToken: string): Record<string, unknown> {
  const parts = idToken.split(".");
  if (parts.length !== 3) return {};
  try {
    const padded = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, "="))) as Record<
      string,
      unknown
    >;
  } catch {
    return {};
  }
}

/** Refresh-токен → свежий access-токен. Живёт час, поэтому не хранится. */
export async function refreshAccessToken(refreshToken: string): Promise<string> {
  const tokens = await postToken({
    client_id: clientId(),
    client_secret: clientSecret(),
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });
  const accessToken = typeof tokens.access_token === "string" ? tokens.access_token : "";
  if (!accessToken) throw new Error("Google не обновил access_token");
  return accessToken;
}

/** Ошибка запроса к API — со статусом, чтобы отзыв доступа отличался от сбоя сети. */
export class GoogleApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "GoogleApiError";
  }
}

async function apiGet<T>(accessToken: string, path: string, query: Record<string, string>): Promise<T> {
  const url = new URL(`${CALENDAR_API}${path}`);
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new GoogleApiError(response.status, `Google Calendar ответил ${response.status}: ${text.slice(0, 200)}`);
  }
  return JSON.parse(text) as T;
}

export interface GoogleCalendarEntry {
  id: string;
  summary: string;
  backgroundColor: string | null;
  timeZone: string | null;
  /** Скрытые в самом Google не показываем и мы: человек их уже убрал. */
  hidden: boolean;
  deleted: boolean;
}

interface CalendarListResponse {
  items?: Array<{
    id?: string;
    summary?: string;
    summaryOverride?: string;
    backgroundColor?: string;
    timeZone?: string;
    hidden?: boolean;
    deleted?: boolean;
    selected?: boolean;
  }>;
  nextPageToken?: string;
}

/** Календари аккаунта. Подключают аккаунт целиком, выбирают уже у нас. */
export async function listCalendars(accessToken: string): Promise<GoogleCalendarEntry[]> {
  const out: GoogleCalendarEntry[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const query: Record<string, string> = { maxResults: "250", showHidden: "true" };
    if (pageToken) query.pageToken = pageToken;
    const data = await apiGet<CalendarListResponse>(accessToken, "/users/me/calendarList", query);
    for (const item of data.items ?? []) {
      if (!item.id) continue;
      out.push({
        id: item.id,
        // summaryOverride — имя, которое человек дал календарю у себя; оно
        // ближе к тому, как он его называет, чем summary владельца.
        summary: item.summaryOverride || item.summary || item.id,
        backgroundColor: item.backgroundColor ?? null,
        timeZone: item.timeZone ?? null,
        hidden: item.hidden === true,
        deleted: item.deleted === true,
      });
    }
    pageToken = data.nextPageToken;
    if (!pageToken) break;
  }
  return out;
}

/** Событие в форме, уже готовой лечь в `core.calendar_events`. */
export interface ExternalEvent {
  externalId: string;
  title: string;
  description: string | null;
  location: string | null;
  allDay: boolean;
  /** Дни включительно — только у «весь день». */
  startDate: string | null;
  endDate: string | null;
  /** Моменты в ISO — только у события со временем. */
  startsAt: string | null;
  endsAt: string | null;
  status: string | null;
  organizer: string | null;
  htmlLink: string | null;
  externalUpdatedAt: string | null;
}

interface EventsResponse {
  items?: Array<{
    id?: string;
    summary?: string;
    description?: string;
    location?: string;
    status?: string;
    htmlLink?: string;
    updated?: string;
    organizer?: { email?: string; displayName?: string };
    start?: { date?: string; dateTime?: string };
    end?: { date?: string; dateTime?: string };
  }>;
  nextPageToken?: string;
}

/**
 * События календаря за окно. `singleEvents=true` разворачивает повторы на
 * стороне Google — свой разворот RRULE здесь был бы второй реализацией того, что
 * уже сделано правильно, с часовыми поясами и переопределениями отдельных
 * экземпляров.
 *
 * `showDeleted=false`: отменённое нам не нужно, потому что окно перечитывается
 * целиком и исчезнувшее событие пропадает само.
 */
export async function listEvents(
  accessToken: string,
  calendarId: string,
  window: { timeMin: string; timeMax: string },
): Promise<ExternalEvent[]> {
  const out: ExternalEvent[] = [];
  let pageToken: string | undefined;

  for (let page = 0; page < MAX_PAGES; page++) {
    const query: Record<string, string> = {
      singleEvents: "true",
      orderBy: "startTime",
      showDeleted: "false",
      maxResults: String(PAGE_SIZE),
      timeMin: window.timeMin,
      timeMax: window.timeMax,
    };
    if (pageToken) query.pageToken = pageToken;
    const data = await apiGet<EventsResponse>(
      accessToken,
      `/calendars/${encodeURIComponent(calendarId)}/events`,
      query,
    );

    for (const item of data.items ?? []) {
      const event = toExternalEvent(item);
      if (event) out.push(event);
    }
    pageToken = data.nextPageToken;
    if (!pageToken) break;
  }

  return out;
}

function toExternalEvent(item: NonNullable<EventsResponse["items"]>[number]): ExternalEvent | null {
  if (!item.id) return null;
  const start = item.start;
  const end = item.end;
  if (!start || !end) return null;

  const organizer = item.organizer?.displayName || item.organizer?.email || null;
  const base = {
    externalId: item.id,
    title: item.summary ?? "",
    description: item.description ?? null,
    location: item.location ?? null,
    status: item.status ?? null,
    organizer,
    htmlLink: item.htmlLink ?? null,
    externalUpdatedAt: item.updated ?? null,
  };

  if (start.date && end.date) {
    // Google отдаёт конец «весь день» ИСКЛЮЧИТЕЛЬНО (событие на 30-е — это
    // 30-е…31-е), а мы храним включительно, как полосу ганта.
    return {
      ...base,
      allDay: true,
      startDate: start.date,
      endDate: exclusiveEndToInclusive(start.date, end.date),
      startsAt: null,
      endsAt: null,
    };
  }

  if (start.dateTime && end.dateTime) {
    return {
      ...base,
      allDay: false,
      startDate: null,
      endDate: null,
      startsAt: new Date(start.dateTime).toISOString(),
      endsAt: new Date(end.dateTime).toISOString(),
    };
  }

  return null;
}

/** «По 31-е исключительно» → «по 30-е включительно», но не раньше начала. */
function exclusiveEndToInclusive(startDate: string, endDateExclusive: string): string {
  const ms = Date.parse(`${endDateExclusive}T00:00:00Z`) - 86_400_000;
  const d = new Date(ms);
  const inclusive = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
  return inclusive < startDate ? startDate : inclusive;
}
