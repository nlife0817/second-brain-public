// Проверочное сообщение себе в телеграм — та же роль, что у /push/test:
// между привязкой и первым реальным событием могут пройти часы.

import { NextRequest, NextResponse } from "next/server";
import { withUser } from "@/lib/core/context";
import { jsonError } from "@/lib/core/http";
import { sendTestTelegram } from "@/lib/core/telegram";

export const POST = withUser(async (_request: NextRequest, user) => {
  const result = await sendTestTelegram(user.id);
  if (result === "none") return jsonError(409, "Телеграм не подключён");
  if (result === "dead") {
    return jsonError(409, "Бот заблокирован в телеграме — подключите чат заново");
  }
  if (result === "failed") {
    return jsonError(502, "Телеграм не принял сообщение — попробуйте ещё раз");
  }
  return NextResponse.json({ sent: 1 });
});
