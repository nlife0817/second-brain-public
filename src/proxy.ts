import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { getSessionUser } from "@/lib/supabase/claims";

function isMobileUserAgent(ua: string): boolean {
  return /Mobile|Android|iPhone|iPad|iPod/i.test(ua);
}

// /invite/* открыт до входа: страница сама показывает кнопку «Войти» с возвратом.
const PUBLIC_PATHS = ["/login", "/auth/callback", "/mockup", "/invite"];

// Local-only dev bypass. Active iff both conditions hold:
//   1) NODE_ENV !== "production"  (Vercel builds always set this to "production")
//   2) DEV_USER_EMAIL env var is set
// When active, proxy skips the Supabase session check and treats every request as
// authenticated. getAuthUser() also honors this env var to return a real DB user row.
const DEV_BYPASS_ACTIVE =
  process.env.NODE_ENV !== "production" && !!process.env.DEV_USER_EMAIL;

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  let response = NextResponse.next({ request });

  if (DEV_BYPASS_ACTIVE) {
    const ua = request.headers.get("user-agent") ?? "";
    if (
      pathname === "/" &&
      isMobileUserAgent(ua) &&
      !request.nextUrl.searchParams.has("desktop")
    ) {
      return NextResponse.redirect(new URL("/m/tasks", request.url));
    }
    return response;
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
    ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  // Обновление cookie сессии + проверка подписи (локально, без сетевого вызова
  // к /auth/v1/user на каждый запрос — см. lib/supabase/claims.ts).
  const user = await getSessionUser(supabase);

  const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));

  if (!user && !isPublic) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  // Mobile redirect for root path (only for authenticated users).
  const ua = request.headers.get("user-agent") ?? "";
  if (
    user &&
    pathname === "/" &&
    isMobileUserAgent(ua) &&
    !request.nextUrl.searchParams.has("desktop")
  ) {
    return NextResponse.redirect(new URL("/m/tasks", request.url));
  }

  return response;
}

export const config = {
  matcher: [
    // api/v2/invitations исключён: GET показывает приглашение до входа, POST
    // сам требует сессию через withUser.
    "/((?!_next|api/cron|api/v2/cron|api/notifications/dispatch|api/timing/watchdog|api/mcp|api/v2/invitations|icons|favicon|manifest|sw\\.js).*)",
  ],
};
