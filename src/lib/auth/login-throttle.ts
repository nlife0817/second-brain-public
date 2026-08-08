// Ограничение частоты попыток входа.
//
// Счётчик в памяти процесса, а не в базе: приложение крутится одним
// контейнером (deploy/docker-compose.yml), и поход в Postgres на каждую
// неудачную попытку дороже самой защиты. При переезде на несколько реплик
// счётчик придётся вынести — до тех пор это осознанное упрощение.
//
// Ключ — email вместе с IP: только по IP страдает вся организация за одним
// NAT, только по email — любой желающий запирает чужую учётку.

const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 10;

/** Верхняя граница записей: без неё перебор адресов надувает Map без предела. */
const MAX_ENTRIES = 10_000;

interface Attempt {
  count: number;
  /** Когда окно закончится, миллисекунды. */
  resetAt: number;
}

const attempts = new Map<string, Attempt>();

function sweep(now: number): void {
  for (const [key, value] of attempts) {
    if (value.resetAt <= now) attempts.delete(key);
  }
}

/** IP клиента за обратным прокси Caddy. */
export function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return request.headers.get("x-real-ip")?.trim() || "unknown";
}

/**
 * Исчерпан ли лимит. Сколько секунд ждать — для заголовка Retry-After,
 * иначе null.
 */
export function throttleRetryAfter(key: string): number | null {
  const now = Date.now();
  const entry = attempts.get(key);
  if (!entry || entry.resetAt <= now) return null;
  if (entry.count < MAX_ATTEMPTS) return null;
  return Math.ceil((entry.resetAt - now) / 1000);
}

/** Считает неудачную попытку. Успешный вход счётчик снимает (`clearAttempts`). */
export function recordFailure(key: string): void {
  const now = Date.now();
  if (attempts.size > MAX_ENTRIES) sweep(now);

  const entry = attempts.get(key);
  if (!entry || entry.resetAt <= now) {
    attempts.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return;
  }
  entry.count += 1;
}

export function clearAttempts(key: string): void {
  attempts.delete(key);
}
