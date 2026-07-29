// Личные настройки доставки: часовой пояс, тихие часы, час утренней сводки,
// выключатель напоминаний. Одна строка на пользователя (core.notification_settings).
//
// Отсутствие строки — значения по умолчанию, поэтому читать надо через
// getDeliverySettings, а не «SELECT … WHERE user_id = ?» в каждом месте.

import { prepare } from "@/lib/sql";

export interface DeliverySettings {
  /** IANA-зона: сроки задач хранятся без зоны и существуют только локально. */
  timezone: string;
  quiet_enabled: boolean;
  /** «HH:MM» — окно может пересекать полночь (22:00 → 08:00). */
  quiet_start: string;
  quiet_end: string;
  digest_hour: number;
  reminders_enabled: boolean;
}

export const DEFAULT_DELIVERY: DeliverySettings = {
  timezone: "Asia/Novosibirsk",
  quiet_enabled: false,
  quiet_start: "22:00",
  quiet_end: "08:00",
  digest_hour: 9,
  reminders_enabled: true,
};

/** Postgres отдаёт time как «HH:MM:SS» — интерфейсу нужны часы и минуты. */
function toHhMm(value: string): string {
  return value.slice(0, 5);
}

export async function getDeliverySettings(userId: string): Promise<DeliverySettings> {
  const row = await prepare<DeliverySettings>(
    `SELECT timezone, quiet_enabled, quiet_start::text, quiet_end::text,
            digest_hour, reminders_enabled
     FROM core.notification_settings WHERE user_id = ?`,
  ).get(userId);
  if (!row) return DEFAULT_DELIVERY;
  return {
    ...row,
    digest_hour: Number(row.digest_hour),
    quiet_start: toHhMm(row.quiet_start),
    quiet_end: toHhMm(row.quiet_end),
  };
}

/**
 * Проверка зоны перед записью. Кривое значение в этой колонке ломает не одну
 * настройку, а весь диспетчер: `AT TIME ZONE 'Марс/Олимп'` в SQL — ошибка
 * выполнения, и рассылка встаёт целиком.
 */
export function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export function isValidHhMm(value: string): boolean {
  return HHMM_RE.test(value);
}

export async function saveDeliverySettings(
  userId: string,
  patch: Partial<DeliverySettings>,
): Promise<DeliverySettings> {
  const current = await getDeliverySettings(userId);
  const next: DeliverySettings = { ...current, ...patch };
  await prepare(
    `INSERT INTO core.notification_settings
       (user_id, timezone, quiet_enabled, quiet_start, quiet_end, digest_hour, reminders_enabled)
     VALUES (?, ?, ?, ?::time, ?::time, ?, ?)
     ON CONFLICT (user_id) DO UPDATE SET
       timezone = EXCLUDED.timezone,
       quiet_enabled = EXCLUDED.quiet_enabled,
       quiet_start = EXCLUDED.quiet_start,
       quiet_end = EXCLUDED.quiet_end,
       digest_hour = EXCLUDED.digest_hour,
       reminders_enabled = EXCLUDED.reminders_enabled,
       updated_at = now()`,
  ).run(
    userId,
    next.timezone,
    next.quiet_enabled,
    next.quiet_start,
    next.quiet_end,
    next.digest_hour,
    next.reminders_enabled,
  );
  return next;
}

/**
 * Действуют ли тихие часы в данный момент по местному времени.
 *
 * Окно может пересекать полночь — тогда «внутри» означает «после начала или до
 * конца», а не «между». Чистая функция: её же логику проверяют тесты, а SQL в
 * диспетчере повторяет ровно это условие.
 */
export function isQuietNow(settings: DeliverySettings, localHhMm: string): boolean {
  if (!settings.quiet_enabled) return false;
  const { quiet_start: start, quiet_end: end } = settings;
  if (start === end) return false; // пустое окно, а не «всегда тихо»
  return start < end ? localHhMm >= start && localHhMm < end : localHhMm >= start || localHhMm < end;
}
