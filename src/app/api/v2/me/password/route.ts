// Смена собственного пароля.
//
// Текущий пароль спрашиваем только у того, у кого он есть. У кого нет — это
// человек, вошедший ещё по прежней схеме (Google) и живущий на действующей
// cookie: подтверждать ему нечем, а сессия личность уже доказала.

import { NextResponse } from "next/server";
import { hashPassword, passwordProblem, verifyPassword } from "@/lib/auth/password";
import { withUser } from "@/lib/core/context";
import { getCredentialsByEmail, setPassword } from "@/lib/core/credentials";
import { DomainError } from "@/lib/core/http";

export const PUT = withUser(async (request, user) => {
  let body: { current_password?: unknown; new_password?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    throw new DomainError(400, "Ожидается JSON");
  }

  const current = typeof body.current_password === "string" ? body.current_password : "";
  const next = typeof body.new_password === "string" ? body.new_password : "";

  const problem = passwordProblem(next);
  if (problem) throw new DomainError(400, problem);

  const credentials = await getCredentialsByEmail(user.email);
  if (!credentials) throw new DomainError(404, "Пользователь не найден");

  if (credentials.password_hash && !(await verifyPassword(current, credentials.password_hash))) {
    throw new DomainError(400, "Текущий пароль неверен");
  }

  await setPassword(credentials.id, await hashPassword(next));
  return NextResponse.json({ ok: true });
});
