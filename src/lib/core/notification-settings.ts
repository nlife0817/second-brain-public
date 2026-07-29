// Личные настройки доставки: чтение и запись core.notification_settings.
// Форма данных, значения по умолчанию и правило тихих часов — в ./delivery.ts
// (их читает и браузер).
//
// Отсутствие строки — значения по умолчанию, поэтому читать надо через
// getDeliverySettings, а не «SELECT … WHERE user_id = ?» в каждом месте.

import { prepare } from "@/lib/sql";
import { DEFAULT_DELIVERY, type DeliverySettings } from "./delivery";

export { DEFAULT_DELIVERY, isQuietNow, isValidHhMm, isValidTimezone } from "./delivery";
export type { DeliverySettings } from "./delivery";

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
