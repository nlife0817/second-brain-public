// Установка пароля по одноразовой ссылке. Публичный роут: человек сюда попадает
// именно потому, что войти пока не может.
//
// Право на действие подтверждает сам токен — 256 случайных бит, живущих двое
// суток и сгорающих при первом использовании. Почты в системе нет, поэтому
// ссылка передаётся лично; это её и делает bearer-секретом.

import { NextResponse, type NextRequest } from "next/server";
import { hashPassword, passwordProblem } from "@/lib/auth/password";
import { SESSION_COOKIE, sessionCookieOptions, signSession } from "@/lib/auth/session";
import { consumePasswordToken } from "@/lib/core/credentials";
import { toHttpError } from "@/lib/core/http";

export async function POST(request: NextRequest) {
  let body: { token?: unknown; password?: unknown; name?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Ожидается JSON" }, { status: 400 });
  }

  const token = typeof body.token === "string" ? body.token : "";
  const password = typeof body.password === "string" ? body.password : "";
  const name = typeof body.name === "string" ? body.name.trim().slice(0, 200) : "";
  if (!token) return NextResponse.json({ error: "Ссылка недействительна" }, { status: 400 });

  const problem = passwordProblem(password);
  if (problem) return NextResponse.json({ error: problem }, { status: 400 });

  try {
    // Хешируем до похода в базу: scrypt считается десятки миллисекунд, и держать
    // транзакцию открытой всё это время незачем.
    const user = await consumePasswordToken(token, await hashPassword(password), name);

    // Сразу входим: человек только что доказал владение ссылкой и знает пароль —
    // отправлять его после этого на экран входа значит просить ввести то же самое.
    const session = await signSession({ id: user.id, email: user.email, fullName: user.name });
    const response = NextResponse.json({ ok: true });
    response.cookies.set(SESSION_COOKIE, session, sessionCookieOptions());
    return response;
  } catch (err) {
    return toHttpError(err);
  }
}
