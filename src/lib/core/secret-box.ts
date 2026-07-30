// Шифрование секретов подключённых календарей: refresh-токена Google и приватной
// ICS-ссылки.
//
// Зачем вообще шифровать, если база и так наша: содержимое `core` целиком уезжает
// в ночной дамп (deploy/backup.sh), а дампы лежат на диске сервера и на нём же
// хранятся две недели. Refresh-токен Google при этом даёт доступ к чужому
// календарю на неограниченный срок и в отличие от сессии не «переподписывается» —
// отозвать его можно только руками в аккаунте Google. Приватная ICS-ссылка это
// тот же секрет в виде URL: кто её знает, читает календарь целиком.
//
// Ключ живёт в окружении (`CALENDAR_TOKEN_KEY`), то есть в `deploy/.env`, а не в
// базе — иначе шифрование не значило бы ничего: дамп содержал бы и замок, и ключ.
// Отсюда следствие, которое надо помнить: потеря ключа означает, что подключения
// придётся завести заново (сами календари и события восстановятся синхронизацией).
//
// AES-256-GCM через WebCrypto: тот же общий знаменатель, что у подписи сессии
// (lib/auth/session.ts) — без node:crypto, чтобы код не был привязан к рантайму.

import { fromBase64Url, toBase64Url } from "@/lib/auth/base64url";

/** Формат хранения: версия, чтобы смена схемы не требовала угадывания. */
const PREFIX = "v1";
/** GCM рекомендует 96-битный вектор. */
const IV_BYTES = 12;

let cached: Promise<CryptoKey> | null = null;

/**
 * Ключ шифрования из окружения. Принимается hex (64 символа) или base64url —
 * оба формата даёт `openssl rand`, и заставлять выбирать один незачем.
 */
function keyBytes(): Uint8Array<ArrayBuffer> {
  const raw = process.env.CALENDAR_TOKEN_KEY?.trim();
  if (!raw) {
    throw new Error(
      "CALENDAR_TOKEN_KEY не задан: без него подключить внешний календарь нельзя. " +
        "Сгенерировать — `openssl rand -hex 32`, положить в deploy/.env.",
    );
  }
  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    const bytes = new Uint8Array(new ArrayBuffer(32));
    for (let i = 0; i < 32; i++) bytes[i] = Number.parseInt(raw.slice(i * 2, i * 2 + 2), 16);
    return bytes;
  }
  const bytes = fromBase64Url(raw);
  if (bytes.length !== 32) {
    throw new Error("CALENDAR_TOKEN_KEY должен быть 32 байта: 64 hex-символа или base64url");
  }
  return bytes;
}

/** Импорт один раз на модуль: WebCrypto каждый раз считает заново. */
function key(): Promise<CryptoKey> {
  if (!cached) {
    cached = crypto.subtle.importKey("raw", keyBytes(), { name: "AES-GCM" }, false, [
      "encrypt",
      "decrypt",
    ]);
  }
  return cached;
}

/** Секрет → строка для колонки. Вектор новый на каждое шифрование. */
export async function sealSecret(plain: string): Promise<string> {
  const iv = new Uint8Array(new ArrayBuffer(IV_BYTES));
  crypto.getRandomValues(iv);
  const cipher = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    await key(),
    new TextEncoder().encode(plain),
  );
  return `${PREFIX}.${toBase64Url(iv)}.${toBase64Url(new Uint8Array(cipher))}`;
}

/**
 * Обратно. Бросает, если ключ сменился или строка испорчена: молча вернуть
 * пустой секрет значило бы «синхронизация просто перестала работать» без следа
 * причины.
 */
export async function openSecret(sealed: string): Promise<string> {
  const parts = sealed.split(".");
  if (parts.length !== 3 || parts[0] !== PREFIX) {
    throw new Error("Секрет подключения записан в неизвестном формате");
  }
  try {
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: fromBase64Url(parts[1]) },
      await key(),
      fromBase64Url(parts[2]),
    );
    return new TextDecoder().decode(plain);
  } catch (err) {
    // WebCrypto на неподходящем ключе бросает «operation-specific reason» — текст,
    // по которому причину не найти. А причина ровно одна и понятная: ключ
    // сменился, и подключение надо завести заново. Этот текст видит человек в
    // настройках, поэтому он и должен быть здесь.
    if (err instanceof Error && err.name === "TypeError") throw err;
    throw new Error("не удалось расшифровать доступ — ключ CALENDAR_TOKEN_KEY изменился, подключите календарь заново");
  }
}

/** Задан ли ключ вовсе — экран настроек показывает это до попытки подключения. */
export function secretsConfigured(): boolean {
  try {
    keyBytes();
    return true;
  } catch {
    return false;
  }
}
