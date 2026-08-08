// Просмотр и принятие приглашения. Роут вне контекста организации: пользователь
// ещё не её участник. Токен приходит сырым, в БД лежит только его sha256.

import { NextResponse } from "next/server";
import { withUser } from "@/lib/core/context";
import { getCredentialsByEmail } from "@/lib/core/credentials";
import { DomainError, jsonError, toHttpError } from "@/lib/core/http";
import { acceptInvitation, peekInvitation } from "@/lib/core/identity";
import { getCoreUser } from "@/lib/core/context";
import type { NextRequest } from "next/server";

/** Что за приглашение — доступно и до входа (без раскрытия деталей организации). */
export async function GET(
  _request: NextRequest,
  context: { params: Promise<Record<string, string>> },
) {
  try {
    const { token } = await context.params;
    const info = await peekInvitation(token);
    if (!info) return jsonError(404, "Приглашение не найдено или истекло");
    const user = await getCoreUser();
    // Завести пароль прямо здесь может только тот, у кого его ещё нет: иначе
    // пересланная ссылка приглашения становится способом перезадать пароль
    // существующей учётки (см. /api/auth/invite-signup).
    const credentials = await getCredentialsByEmail(info.email);
    return NextResponse.json({
      org_name: info.org_name,
      email: info.email,
      org_role: info.org_role,
      signed_in_as: user?.email ?? null,
      email_matches: user ? user.email === info.email : null,
      can_sign_up: !credentials?.password_hash,
    });
  } catch (err) {
    return toHttpError(err);
  }
}

export const POST = withUser(async (request, user) => {
  const token = request.nextUrl.pathname.split("/").pop() ?? "";
  if (!token) throw new DomainError(400, "Token is required");
  const result = await acceptInvitation(token, user);
  return NextResponse.json(result);
});
