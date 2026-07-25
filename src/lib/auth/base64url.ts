// base64url без Buffer: код авторизации исполняется и в proxy (Edge runtime,
// где нет node:crypto и node:buffer), и в обычных роутах Node. Общий знаменатель —
// Web API, то есть atob/btoa.

export function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// Возвращаемый тип уточнён до Uint8Array<ArrayBuffer>: crypto.subtle ждёт
// BufferSource поверх обычного ArrayBuffer, а вывод по умолчанию —
// ArrayBufferLike, куда попадает и SharedArrayBuffer.
export function fromBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const padded = value
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function utf8ToBase64Url(text: string): string {
  return toBase64Url(new TextEncoder().encode(text));
}

export function base64UrlToUtf8(value: string): string {
  return new TextDecoder().decode(fromBase64Url(value));
}

/** Криптографически стойкая случайная строка (для state и code_verifier). */
export function randomToken(byteLength = 32): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return toBase64Url(bytes);
}
