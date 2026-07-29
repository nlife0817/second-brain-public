// Личные настройки доставки — чистая часть: форма данных, значения по
// умолчанию, проверки и правило тихих часов.
//
// Отдельно от notification-settings.ts, который ходит в базу: этот модуль
// нужен и экрану настроек в браузере, а тянуть в его бандл postgres нельзя.

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

/** Поле времени в браузере отдаёт пустую строку, пока значение не дозаполнено. */
export function isValidHhMm(value: string): boolean {
  return HHMM_RE.test(value);
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
