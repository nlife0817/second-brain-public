// Хеширование паролей: scrypt из node:crypto.
//
// Почему scrypt, а не bcrypt/argon2: оба — нативные модули, а образ приложения
// собирается standalone-сборкой Next и катится на VPS без тулчейна. scrypt
// живёт в стандартной библиотеке Node, признан подходящим для паролей
// (RFC 7914, OWASP Password Storage Cheat Sheet) и не тянет ни одной
// зависимости.
//
// Модуль намеренно только для рантайма Node: proxy исполняется на Edge, но
// пароль там не проверяется — туда попадает уже подписанная cookie сессии.

import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { PASSWORD_MAX_LENGTH } from "./password-rules";

// Требования к паролю живут в password-rules.ts — их же читают формы в браузере.
export { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, passwordProblem } from "./password-rules";

const scryptAsync = promisify(scrypt) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

/**
 * Параметры OWASP для scrypt: N=2^17, r=8, p=1 — примерно 130 МБ и десятки
 * миллисекунд на проверку. Записываются в сам хеш, поэтому их можно поднять
 * позже, не ломая уже сохранённые пароли.
 */
const N = 1 << 17;
const R = 8;
const P = 1;
const KEY_LENGTH = 32;
const SALT_LENGTH = 16;

// Node считает лимит памяти по умолчанию как 32 МБ и отказывается считать
// scrypt с N=2^17 — предел приходится задавать явно (128 * N * r с запасом).
const MAX_MEM = 256 * 1024 * 1024;

function encode(buf: Buffer): string {
  return buf.toString("base64url");
}

/** Хеш пароля для записи в core.users.password_hash. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const derived = await scryptAsync(password, salt, KEY_LENGTH, { N, r: R, p: P, maxmem: MAX_MEM });
  return `scrypt$${N}$${R}$${P}$${encode(salt)}$${encode(derived)}`;
}

/**
 * Совпадает ли пароль с хешем.
 *
 * Никогда не бросает: битая или чужая запись в колонке — это «пароль не
 * подошёл», а не 500 на экране входа.
 */
export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  if (!stored) return false;
  try {
    const [scheme, n, r, p, salt, hash] = stored.split("$");
    if (scheme !== "scrypt") return false;

    const params = { N: Number(n), r: Number(r), p: Number(p), maxmem: MAX_MEM };
    if (!Number.isInteger(params.N) || !Number.isInteger(params.r) || !Number.isInteger(params.p)) {
      return false;
    }

    const expected = Buffer.from(hash, "base64url");
    if (expected.length === 0) return false;

    const derived = await scryptAsync(password, Buffer.from(salt, "base64url"), expected.length, params);
    // timingSafeEqual требует одинаковой длины и сравнивает за постоянное время.
    return derived.length === expected.length && timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

/**
 * Проверка «вхолостую» для несуществующего адреса.
 *
 * Без неё ответ на незнакомый email приходит заметно быстрее, чем на знакомый,
 * и перебор адресов по времени ответа становится тривиальным.
 */
export async function fakeVerify(password: string): Promise<void> {
  await scryptAsync(password.slice(0, PASSWORD_MAX_LENGTH), randomBytes(SALT_LENGTH), KEY_LENGTH, {
    N,
    r: R,
    p: P,
    maxmem: MAX_MEM,
  });
}
