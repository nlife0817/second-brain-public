// Ссылка «задать пароль» для участника организации.
//
// Только владелец: выдать ссылку — это фактически войти под этим человеком, а
// не «управлять составом». Право org.members.manage есть и у администратора, и
// приравнивать к нему захват учётки владельца нельзя.
//
// Почты в системе нет, поэтому ссылка возвращается в ответе — владелец
// копирует её и передаёт лично, как уже устроены приглашения.

import { NextResponse } from "next/server";
import { withOrg } from "@/lib/core/context";
import { createPasswordToken } from "@/lib/core/credentials";
import { isUuid, jsonError } from "@/lib/core/http";
import { getMembershipRole } from "@/lib/core/identity";

export const POST = withOrg(
  async (request, { params, auth }) => {
    const { userId } = await params;
    if (!isUuid(userId)) return jsonError(404, "Member not found");

    // Ссылку выдаём только своему участнику: без этой проверки владелец любой
    // организации выписывал бы её на произвольный id из core.users.
    const role = await getMembershipRole(auth.orgId, userId);
    if (!role) return jsonError(404, "Member not found");

    const token = await createPasswordToken({ userId, createdBy: auth.user.id });
    const origin = process.env.NEXT_PUBLIC_APP_URL ?? request.nextUrl.origin;
    return NextResponse.json({ url: `${origin}/set-password/${token}` }, { status: 201 });
  },
  { minOrgRole: "owner" },
);
