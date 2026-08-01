// Заведение учётки прямо по приглашению: имя, пароль — и человек внутри.
//
// Публичный роут; право на действие подтверждает токен приглашения. Если у
// адреса пароль уже есть, регистрацию не даём: иначе пересланная кому-то ссылка
// приглашения становится способом перезадать пароль существующей учётки и
// войти под ней. Такому человеку — обычный вход, приглашение он примет уже
// изнутри.

import { NextResponse, type NextRequest } from "next/server";
import { hashPassword, passwordProblem } from "@/lib/auth/password";
import { SESSION_COOKIE, sessionCookieOptions, signSession } from "@/lib/auth/session";
import { getCredentialsByEmail, setPassword } from "@/lib/core/credentials";
import { toHttpError } from "@/lib/core/http";
import { acceptInvitation, createUser, peekInvitation } from "@/lib/core/identity";

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
  if (!token) {
    return NextResponse.json({ error: "Приглашение недействительно" }, { status: 400 });
  }

  const problem = passwordProblem(password);
  if (problem) return NextResponse.json({ error: problem }, { status: 400 });

  try {
    const invitation = await peekInvitation(token);
    if (!invitation) {
      return NextResponse.json(
        { error: "Приглашение не найдено или истекло" },
        { status: 404 },
      );
    }

    const existing = await getCredentialsByEmail(invitation.email);
    if (existing?.password_hash) {
      return NextResponse.json(
        { error: "У этого адреса уже есть пароль — войдите и примите приглашение" },
        { status: 409 },
      );
    }

    // createUser идемпотентен по email: адрес мог засветиться раньше — например,
    // его назначили ответственным по предыдущему приглашению.
    const user = existing ?? (await createUser({ email: invitation.email, name }));
    const passwordHash = await hashPassword(password);
    await setPassword(user.id, passwordHash);

    // Принимаем сразу: приглашение и есть причина, по которой человек здесь.
    // Порядок важен — пароль ставим первым, иначе сбой на второй половине
    // оставил бы принятое приглашение при учётке, в которую не войти.
    await acceptInvitation(token, { id: user.id, email: invitation.email });

    const session = await signSession({
      id: user.id,
      email: invitation.email,
      fullName: name || user.name,
    });
    const response = NextResponse.json({ ok: true });
    response.cookies.set(SESSION_COOKIE, session, sessionCookieOptions());
    return response;
  } catch (err) {
    return toHttpError(err);
  }
}
