// Вход по email и паролю. Публичный роут: сессии у запроса ещё нет,
// защита — сам пароль плюс ограничение частоты попыток.

import { NextResponse, type NextRequest } from "next/server";
import { fakeVerify, verifyPassword } from "@/lib/auth/password";
import {
  clearAttempts,
  clientIp,
  recordFailure,
  throttleRetryAfter,
} from "@/lib/auth/login-throttle";
import { SESSION_COOKIE, sessionCookieOptions, signSession } from "@/lib/auth/session";
import { getCredentialsByEmail } from "@/lib/core/credentials";

/**
 * Один текст на «нет такого адреса», «неверный пароль» и «пароль ещё не задан».
 * Различать их — значит отдавать посторонним список тех, кто здесь работает.
 */
const WRONG = "Неверный email или пароль";

export async function POST(request: NextRequest) {
  let body: { email?: unknown; password?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Ожидается JSON" }, { status: 400 });
  }

  const email = typeof body.email === "string" ? body.email.toLowerCase().trim() : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!email || !password) {
    return NextResponse.json({ error: "Введите email и пароль" }, { status: 400 });
  }

  const key = `${email}|${clientIp(request)}`;
  const retryAfter = throttleRetryAfter(key);
  if (retryAfter !== null) {
    return NextResponse.json(
      { error: `Слишком много попыток. Повторите через ${Math.ceil(retryAfter / 60)} мин` },
      { status: 429, headers: { "Retry-After": String(retryAfter) } },
    );
  }

  const credentials = await getCredentialsByEmail(email);

  // Незнакомый адрес всё равно стоит одного scrypt: иначе ответ на него
  // приходит мгновенно, и перебор адресов по времени ответа тривиален.
  if (!credentials) {
    await fakeVerify(password);
    recordFailure(key);
    return NextResponse.json({ error: WRONG }, { status: 401 });
  }

  if (!(await verifyPassword(password, credentials.password_hash))) {
    recordFailure(key);
    return NextResponse.json({ error: WRONG }, { status: 401 });
  }

  clearAttempts(key);

  const session = await signSession({
    id: credentials.id,
    email: credentials.email,
    fullName: credentials.name,
  });
  // Редирект делает клиент: форма отправляется fetch'ем, чтобы показать ошибку
  // без перезагрузки страницы.
  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, session, sessionCookieOptions());
  return response;
}
