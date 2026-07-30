// Внешние календари: подключения, список календарей, кэш событий и
// синхронизация.
//
// Ключевые решения, которые легко нарушить обратной правкой:
//
//  1. **Подключение принадлежит пользователю, а не организации** (миграция
//     0046). Отсюда все запросы фильтруются по `user_id`, а не по `org_id`, и
//     никакой org-роли здесь не проверяется: свой календарь настраивает себе
//     каждый, включая гостя.
//  2. **События — кэш чужого источника, а не наши данные.** Пишет их только
//     синхронизация, приложение читает. Задачами они не становятся никогда,
//     поэтому ссылок на `core.tasks` в этих таблицах нет.
//  3. **Окно перечитывается целиком.** Инкрементальной синхронизации у Google
//     здесь нет по построению: `syncToken` несовместим с `timeMin`/`timeMax`, а
//     без окна `singleEvents=true` разворачивает повторы за всю историю
//     календаря. Замена окна идёт одной транзакцией — иначе между удалением и
//     вставкой экран показал бы пустой календарь.
//  4. **Секрет подключения наружу не отдаётся ни одним роутом.** Refresh-токен
//     и приватная ICS-ссылка лежат зашифрованными (`secret-box.ts`), а в API
//     уходит только подпись (`label`).

import { DomainError } from "./http";
import {
  GoogleApiError,
  listCalendars,
  listEvents,
  refreshAccessToken,
  type ExternalEvent,
} from "./google-calendar";
import { addDays } from "./days";
import { parseIcs } from "./ics";
import { openSecret, sealSecret } from "./secret-box";
import { prepare, transaction, type TxContext } from "@/lib/sql";
import type {
  CalendarAccountWithCalendars,
  CalendarBrief,
  CalendarEventRow,
  CalendarProvider,
} from "./types";

/**
 * Скользящее окно синхронизации: сколько прошлого и будущего держим в кэше.
 * Прошлое нужно, чтобы месяц назад не был пустым; год вперёд закрывает
 * планирование и ежегодные события.
 */
const SYNC_WINDOW = { pastDays: 120, futureDays: 400 };

/** Как часто календарь синхронизируется тиком cron. */
const SYNC_EVERY_MINUTES = 30;

/** Ограничение на размер ICS-файла: подписка не должна съесть память процесса. */
const ICS_MAX_BYTES = 5_000_000;
const ICS_TIMEOUT_MS = 20_000;

const CALENDAR_COLUMNS = `id, account_id, name, color, color_override, timezone, visible, last_sync_at`;

// --- Чтение ---------------------------------------------------------------------------

/** Подключения пользователя вместе с их календарями. Секретов в выдаче нет. */
export async function listCalendarAccounts(userId: string): Promise<CalendarAccountWithCalendars[]> {
  const accounts = await prepare<{
    id: string;
    provider: CalendarProvider;
    label: string;
    sync_error: string | null;
    last_sync_at: string | null;
    created_at: string;
  }>(
    `SELECT id, provider, label, sync_error, last_sync_at, created_at
     FROM core.calendar_accounts WHERE user_id = ? ORDER BY created_at`,
  ).all(userId);

  if (accounts.length === 0) return [];

  const ids = accounts.map((a) => a.id);
  const calendars = await prepare<CalendarBrief>(
    `SELECT ${CALENDAR_COLUMNS} FROM core.calendars
     WHERE account_id IN (${ids.map(() => "?").join(",")})
     ORDER BY name`,
  ).all(ids);

  return accounts.map((account) => ({
    ...account,
    calendars: calendars.filter((c) => c.account_id === account.id),
  }));
}

/**
 * События окна по всем видимым календарям пользователя.
 *
 * Два представления ищутся своими ключами: «весь день» — по дням, событие со
 * временем — по моменту. Границы окна расширяются на сутки, потому что момент
 * зависит от зоны читателя: встреча 22:00 по Владивостоку попадает в другой
 * календарный день в Москве, и жёсткая граница по дате её потеряла бы.
 */
export async function listCalendarEvents(
  userId: string,
  window: { from: string; to: string },
): Promise<CalendarEventRow[]> {
  const from = addDays(window.from, -1);
  const to = addDays(window.to, 1);
  return prepare<CalendarEventRow>(
    `SELECT e.id, e.calendar_id, e.title, e.description, e.location, e.all_day,
            e.start_date, e.end_date, e.starts_at, e.ends_at, e.status, e.organizer, e.html_link
     FROM core.calendar_events e
     JOIN core.calendars c ON c.id = e.calendar_id
     JOIN core.calendar_accounts a ON a.id = c.account_id
     WHERE a.user_id = ?
       AND c.visible
       AND (
         (e.all_day AND e.end_date >= ?::date AND e.start_date <= ?::date)
         OR (NOT e.all_day AND e.ends_at >= ?::date AND e.starts_at < (?::date + 1))
       )
     ORDER BY coalesce(e.starts_at, e.start_date::timestamptz), e.title`,
  ).all(userId, from, to, from, to);
}

// --- Подключения ----------------------------------------------------------------------

/** Проверка владения: чужое подключение — 404, а не 403. */
async function requireAccount(userId: string, accountId: string): Promise<{ id: string; provider: CalendarProvider }> {
  const row = await prepare<{ id: string; provider: CalendarProvider }>(
    `SELECT id, provider FROM core.calendar_accounts WHERE id = ? AND user_id = ?`,
  ).get(accountId, userId);
  if (!row) throw new DomainError(404, "Not found");
  return row;
}

async function requireCalendar(userId: string, calendarId: string): Promise<{ id: string }> {
  const row = await prepare<{ id: string }>(
    `SELECT c.id FROM core.calendars c
     JOIN core.calendar_accounts a ON a.id = c.account_id
     WHERE c.id = ? AND a.user_id = ?`,
  ).get(calendarId, userId);
  if (!row) throw new DomainError(404, "Not found");
  return row;
}

/**
 * Подключение Google после согласия. Повторное подключение того же аккаунта
 * обновляет строку, а не заводит вторую: `external_id` — это `sub` аккаунта, и
 * человек, переподключивший календарь после отзыва доступа, ожидает увидеть один
 * аккаунт в списке, а не два.
 */
export async function connectGoogleAccount(
  userId: string,
  grant: { refreshToken: string; email: string; sub: string },
): Promise<string> {
  const secret = await sealSecret(grant.refreshToken);
  const externalId = grant.sub || grant.email;
  if (!externalId) throw new DomainError(422, "Google не сообщил, какой это аккаунт");

  const row = await prepare<{ id: string }>(
    `INSERT INTO core.calendar_accounts (user_id, provider, label, external_id, secret)
     VALUES (?, 'google', ?, ?, ?)
     ON CONFLICT (user_id, provider, external_id) DO UPDATE SET
       label = EXCLUDED.label,
       secret = EXCLUDED.secret,
       sync_error = NULL,
       updated_at = now()
     RETURNING id`,
  ).get(userId, grant.email, externalId, secret);
  if (!row) throw new DomainError(500, "Не удалось сохранить подключение");
  return row.id;
}

/** Подписка на ICS-ссылку. Сама ссылка — секрет: кто её знает, читает календарь. */
export async function connectIcsAccount(userId: string, url: string): Promise<string> {
  let parsed: URL;
  try {
    parsed = new URL(url.trim().replace(/^webcal:/i, "https:"));
  } catch {
    throw new DomainError(422, "Это не похоже на ссылку");
  }
  // Только внешние адреса: ссылка на localhost или на внутренний адрес сети
  // превратила бы подписку в инструмент запросов внутрь нашей инфраструктуры.
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new DomainError(422, "Поддерживаются только ссылки http(s) и webcal");
  }
  if (isPrivateHost(parsed.hostname)) {
    throw new DomainError(422, "Ссылка должна быть на внешний адрес");
  }

  const secret = await sealSecret(parsed.toString());
  // Опознаём подписку по отпечатку ссылки: хранить её открытым текстом ради
  // уникального индекса значило бы обойти собственное шифрование.
  const externalId = await fingerprint(parsed.toString());

  const row = await prepare<{ id: string }>(
    `INSERT INTO core.calendar_accounts (user_id, provider, label, external_id, secret)
     VALUES (?, 'ics', ?, ?, ?)
     ON CONFLICT (user_id, provider, external_id) DO UPDATE SET
       secret = EXCLUDED.secret,
       sync_error = NULL,
       updated_at = now()
     RETURNING id`,
  ).get(userId, parsed.hostname, externalId, secret);
  if (!row) throw new DomainError(500, "Не удалось сохранить подписку");

  // У подписки календарь один; имя уточнится при первой синхронизации.
  await prepare(
    `INSERT INTO core.calendars (account_id, external_id, name)
     VALUES (?, '', ?)
     ON CONFLICT (account_id, external_id) DO NOTHING`,
  ).run(row.id, parsed.hostname);

  return row.id;
}

/** Отпечаток ссылки — SHA-256, чтобы уникальный индекс не хранил сам секрет. */
async function fingerprint(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Адреса, на которые подписка ходить не должна: локальные и служебные диапазоны.
 * Без этого подписка становится способом дёрнуть внутренний сервис от имени
 * приложения (SSRF), в том числе метаданные облака.
 */
function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal")) return true;
  if (host === "::1" || host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80")) return true;
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!v4) return false;
  const [a, b] = [Number(v4[1]), Number(v4[2])];
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true; // метаданные облака
  return false;
}

/** Отключение: события и календари уносит каскад из миграции. */
export async function disconnectAccount(userId: string, accountId: string): Promise<void> {
  await requireAccount(userId, accountId);
  await prepare(`DELETE FROM core.calendar_accounts WHERE id = ? AND user_id = ?`).run(accountId, userId);
}

/** Видимость и цвет календаря — единственное, что пользователь у него правит. */
export async function updateCalendar(
  userId: string,
  calendarId: string,
  patch: { visible?: boolean; color_override?: string | null },
): Promise<CalendarBrief> {
  await requireCalendar(userId, calendarId);
  const sets: string[] = [];
  const values: unknown[] = [];
  if (patch.visible !== undefined) {
    sets.push("visible = ?");
    values.push(patch.visible);
  }
  if (patch.color_override !== undefined) {
    sets.push("color_override = ?");
    values.push(patch.color_override);
  }
  if (sets.length === 0) throw new DomainError(400, "Empty patch");

  const row = await prepare<CalendarBrief>(
    `UPDATE core.calendars SET ${sets.join(", ")}, updated_at = now()
     WHERE id = ? RETURNING ${CALENDAR_COLUMNS}`,
  ).get(...values, calendarId);
  if (!row) throw new DomainError(404, "Not found");
  return row;
}

// --- Синхронизация --------------------------------------------------------------------

export interface SyncReport {
  accounts: number;
  calendars: number;
  events: number;
  errors: string[];
}

function syncWindow(today: string): { from: string; to: string } {
  return { from: addDays(today, -SYNC_WINDOW.pastDays), to: addDays(today, SYNC_WINDOW.futureDays) };
}

/**
 * Синхронизация одного подключения. Ошибка не бросается наружу, а садится в
 * `sync_error`: иначе отозванный доступ в одном аккаунте ронял бы тик cron
 * целиком, а человек не узнал бы, почему календарь встал.
 */
export async function syncAccount(accountId: string, today: string): Promise<SyncReport> {
  const account = await prepare<{
    id: string;
    provider: CalendarProvider;
    secret: string;
    label: string;
  }>(`SELECT id, provider, secret, label FROM core.calendar_accounts WHERE id = ?`).get(accountId);
  if (!account) return { accounts: 0, calendars: 0, events: 0, errors: ["Подключение не найдено"] };

  const report: SyncReport = { accounts: 1, calendars: 0, events: 0, errors: [] };
  try {
    const secret = await openSecret(account.secret);
    const window = syncWindow(today);
    const result =
      account.provider === "google"
        ? await syncGoogle(account.id, secret, window)
        : await syncIcs(account.id, secret, window);
    report.calendars = result.calendars;
    report.events = result.events;
    await prepare(
      `UPDATE core.calendar_accounts SET sync_error = NULL, last_sync_at = now(), updated_at = now() WHERE id = ?`,
    ).run(account.id);
  } catch (err) {
    const message = describeSyncError(err);
    report.errors.push(`${account.label || account.provider}: ${message}`);
    await prepare(
      `UPDATE core.calendar_accounts SET sync_error = ?, last_sync_at = now(), updated_at = now() WHERE id = ?`,
    ).run(message, account.id);
  }
  return report;
}

/** Понятная причина вместо технического текста: её читает человек в настройках. */
function describeSyncError(err: unknown): string {
  if (err instanceof GoogleApiError) {
    if (err.status === 401 || err.status === 403) {
      return "доступ к календарю отозван — подключите аккаунт заново";
    }
    if (err.status === 404) return "календарь удалён в Google";
    if (err.status === 429) return "Google просит подождать — попробуем на следующем тике";
    return `Google ответил ${err.status}`;
  }
  if (err instanceof Error) {
    if (err.message.includes("invalid_grant")) return "доступ к календарю отозван — подключите аккаунт заново";
    return err.message.slice(0, 300);
  }
  return "неизвестная ошибка";
}

/** Все подключения, до которых дошла очередь. Вызывается тиком cron. */
export async function syncDueCalendars(today: string): Promise<SyncReport> {
  const due = await prepare<{ id: string }>(
    `SELECT id FROM core.calendar_accounts
     WHERE last_sync_at IS NULL OR last_sync_at < now() - (? || ' minutes')::interval
     ORDER BY last_sync_at NULLS FIRST
     LIMIT 50`,
  ).all(String(SYNC_EVERY_MINUTES));

  const total: SyncReport = { accounts: 0, calendars: 0, events: 0, errors: [] };
  for (const row of due) {
    const report = await syncAccount(row.id, today);
    total.accounts += report.accounts;
    total.calendars += report.calendars;
    total.events += report.events;
    total.errors.push(...report.errors);
  }
  return total;
}

/** Все подключения пользователя — по кнопке «Обновить» в настройках. */
export async function syncUserCalendars(userId: string, today: string): Promise<SyncReport> {
  const accounts = await prepare<{ id: string }>(
    `SELECT id FROM core.calendar_accounts WHERE user_id = ?`,
  ).all(userId);
  const total: SyncReport = { accounts: 0, calendars: 0, events: 0, errors: [] };
  for (const account of accounts) {
    const report = await syncAccount(account.id, today);
    total.accounts += report.accounts;
    total.calendars += report.calendars;
    total.events += report.events;
    total.errors.push(...report.errors);
  }
  return total;
}

async function syncGoogle(
  accountId: string,
  refreshToken: string,
  window: { from: string; to: string },
): Promise<{ calendars: number; events: number }> {
  const accessToken = await refreshAccessToken(refreshToken);
  const remote = await listCalendars(accessToken);

  // Удалённые в Google убираем у себя: календарь, которого больше нет, иначе
  // навсегда остался бы в списке со своими последними событиями.
  const alive = remote.filter((c) => !c.deleted);
  const known = new Map<string, string>();
  for (const entry of alive) {
    const row = await prepare<{ id: string }>(
      `INSERT INTO core.calendars (account_id, external_id, name, color, timezone)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (account_id, external_id) DO UPDATE SET
         name = EXCLUDED.name,
         color = EXCLUDED.color,
         timezone = EXCLUDED.timezone,
         updated_at = now()
       RETURNING id`,
    ).get(accountId, entry.id, entry.summary, entry.backgroundColor, entry.timeZone);
    if (row) known.set(entry.id, row.id);
  }
  await pruneCalendars(accountId, [...known.keys()]);

  const timeMin = `${window.from}T00:00:00Z`;
  const timeMax = `${window.to}T00:00:00Z`;
  let events = 0;
  for (const [externalId, calendarId] of known) {
    const list = await listEvents(accessToken, externalId, { timeMin, timeMax });
    await replaceEvents(calendarId, list, window);
    events += list.length;
  }
  return { calendars: known.size, events };
}

async function syncIcs(
  accountId: string,
  url: string,
  window: { from: string; to: string },
): Promise<{ calendars: number; events: number }> {
  const calendar = await prepare<{ id: string; http_etag: string | null; name: string }>(
    `SELECT id, http_etag, name FROM core.calendars WHERE account_id = ? ORDER BY created_at LIMIT 1`,
  ).get(accountId);
  if (!calendar) throw new Error("у подписки нет календаря");

  const response = await fetch(url, {
    headers: {
      Accept: "text/calendar, text/plain;q=0.9, */*;q=0.5",
      ...(calendar.http_etag ? { "If-None-Match": calendar.http_etag } : {}),
    },
    signal: AbortSignal.timeout(ICS_TIMEOUT_MS),
    redirect: "follow",
  });

  // 304 — файл не менялся: разбирать его заново незачем.
  if (response.status === 304) return { calendars: 1, events: 0 };
  if (!response.ok) throw new Error(`ссылка ответила ${response.status}`);

  const length = Number(response.headers.get("content-length") ?? 0);
  if (length > ICS_MAX_BYTES) throw new Error("файл подписки слишком большой");
  const text = await response.text();
  if (text.length > ICS_MAX_BYTES) throw new Error("файл подписки слишком большой");
  if (!text.includes("BEGIN:VCALENDAR")) throw new Error("по ссылке не календарь");

  const parsed = parseIcs(text, window);
  await replaceEvents(calendar.id, parsed.events, window);
  await prepare(
    `UPDATE core.calendars SET name = ?, timezone = ?, http_etag = ?, last_sync_at = now(), updated_at = now()
     WHERE id = ?`,
  ).run(parsed.name || calendar.name, parsed.timezone, response.headers.get("etag"), calendar.id);

  return { calendars: 1, events: parsed.events.length };
}

/** Календари, исчезнувшие у провайдера. Пустой список ничего не удаляет. */
async function pruneCalendars(accountId: string, aliveExternalIds: string[]): Promise<void> {
  if (aliveExternalIds.length === 0) return;
  const ph = aliveExternalIds.map(() => "?").join(",");
  await prepare(
    `DELETE FROM core.calendars WHERE account_id = ? AND external_id NOT IN (${ph})`,
  ).run(accountId, aliveExternalIds);
}

/**
 * Замена событий окна одной транзакцией.
 *
 * Удаление и вставка порознь означали бы, что между ними экран показывает пустой
 * календарь — и именно в этот момент чаще всего и смотрят, потому что синк идёт
 * по кнопке «Обновить». Удаляется только окно: события за его пределами нам
 * никто не присылал, и стирать их значило бы терять то, что ещё видно на краях.
 */
async function replaceEvents(
  calendarId: string,
  events: ExternalEvent[],
  window: { from: string; to: string },
): Promise<void> {
  await transaction(async (tx) => {
    await tx
      .prepare(
        `DELETE FROM core.calendar_events
         WHERE calendar_id = ?
           AND (
             (all_day AND end_date >= ?::date AND start_date <= ?::date)
             OR (NOT all_day AND ends_at >= ?::date AND starts_at < (?::date + 1))
           )`,
      )
      .run(calendarId, window.from, window.to, window.from, window.to);

    for (const event of events) await insertEvent(tx, calendarId, event);
  });
}

async function insertEvent(tx: TxContext, calendarId: string, event: ExternalEvent): Promise<void> {
  await tx
    .prepare(
      `INSERT INTO core.calendar_events
         (calendar_id, external_id, title, description, location, all_day,
          start_date, end_date, starts_at, ends_at, status, organizer, html_link, external_updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (calendar_id, external_id) DO UPDATE SET
         title = EXCLUDED.title,
         description = EXCLUDED.description,
         location = EXCLUDED.location,
         all_day = EXCLUDED.all_day,
         start_date = EXCLUDED.start_date,
         end_date = EXCLUDED.end_date,
         starts_at = EXCLUDED.starts_at,
         ends_at = EXCLUDED.ends_at,
         status = EXCLUDED.status,
         organizer = EXCLUDED.organizer,
         html_link = EXCLUDED.html_link,
         external_updated_at = EXCLUDED.external_updated_at,
         updated_at = now()`,
    )
    .run(
      calendarId,
      event.externalId,
      event.title,
      event.description,
      event.location,
      event.allDay,
      event.startDate,
      event.endDate,
      event.startsAt,
      event.endsAt,
      event.status,
      event.organizer,
      event.htmlLink,
      event.externalUpdatedAt,
    );
}
