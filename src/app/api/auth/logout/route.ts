// Выход: снимает cookie сессии.

import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth/session";
import { appOrigin } from "@/lib/auth/urls";

export async function POST(request: NextRequest) {
  const response = NextResponse.redirect(`${appOrigin(request)}/login`, { status: 303 });
  response.cookies.delete(SESSION_COOKIE);
  return response;
}
