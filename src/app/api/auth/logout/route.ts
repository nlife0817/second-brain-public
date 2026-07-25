// Выход: снимает cookie сессии. Отдельного вызова к Google не делаем —
// разлогинивать пользователя в самом Google приложение не вправе.

import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth/session";
import { appOrigin } from "@/lib/auth/oauth-state";

export async function POST(request: NextRequest) {
  const response = NextResponse.redirect(`${appOrigin(request)}/login`, { status: 303 });
  response.cookies.delete(SESSION_COOKIE);
  return response;
}
