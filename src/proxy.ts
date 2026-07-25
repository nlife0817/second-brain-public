import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { getSessionUser } from "@/lib/supabase/claims";

function isMobileUserAgent(ua: string): boolean {
  return /Mobile|Android|iPhone|iPad|iPod/i.test(ua);
}

/**
 * Мобильный адрес для десктопного пути v2 (или null, если маппинга нет).
 * Push-уведомления несут десктопные URL (/v2/my?task=…) — телефон должен
 * попадать на мобильный экран, а десктоп остаться где был.
 */
function mobileV2Target(url: URL): string | null {
  const { pathname } = url;
  if (pathname === "/v2" || pathname === "/v2/my") {
    const task = url.searchParams.get("task");
    return task ? `/v2/m/my?task=${encodeURIComponent(task)}` : "/v2/m/my";
  }
  if (pathname === "/v2/inbox") return "/v2/m/inbox";
  if (pathname === "/v2/time") return "/v2/m/time";
  if (pathname === "/v2/settings") return "/v2/m/settings";
  const project = pathname.match(/^\/v2\/projects\/([^/]+)$/);
  if (project) return `/v2/m/projects/${project[1]}`;
  return null;
}

/** Липкий «режим полной версии»: сессионная cookie, ставится по ?desktop. */
const DESKTOP_COOKIE = "sb_desktop";

/** Общий для dev-байпаса и обычного пути редирект мобильных UA. */
function mobileRedirect(request: NextRequest): NextResponse | null {
  const ua = request.headers.get("user-agent") ?? "";
  if (!isMobileUserAgent(ua)) return null;
  // ?desktop действует на всю сессию браузера, а не на один переход: иначе
  // администрирование в полной версии недостижимо с телефона — любой клик
  // по сайдбару снова уводил бы на /v2/m/*.
  if (request.nextUrl.searchParams.has("desktop")) return null;
  if (request.cookies.has(DESKTOP_COOKIE)) return null;
  if (request.nextUrl.pathname === "/") {
    return NextResponse.redirect(new URL("/m/tasks", request.url));
  }
  const v2 = mobileV2Target(request.nextUrl);
  if (v2) return NextResponse.redirect(new URL(v2, request.url));
  return null;
}

/** Проставляет/снимает cookie режима полной версии по ?desktop / ?mobile. */
function applyDesktopModeCookie(request: NextRequest, response: NextResponse): void {
  if (request.nextUrl.searchParams.has("desktop")) {
    response.cookies.set(DESKTOP_COOKIE, "1", { path: "/", sameSite: "lax" });
  } else if (request.nextUrl.searchParams.has("mobile")) {
    response.cookies.delete(DESKTOP_COOKIE);
  }
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
    const redirected = mobileRedirect(request);
    if (redirected) return redirected;
    applyDesktopModeCookie(request, response);
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

  // Мобильные UA: корень v1 → /m/tasks, десктопные экраны v2 → /v2/m/*
  // (только для авторизованных; обход — ?desktop, возврат — ?mobile).
  if (user) {
    const redirect = mobileRedirect(request);
    if (redirect) return redirect;
  }

  applyDesktopModeCookie(request, response);
  return response;
}

export const config = {
  matcher: [
    // api/v2/invitations исключён: GET показывает приглашение до входа, POST
    // сам требует сессию через withUser.
    "/((?!_next|api/cron|api/v2/cron|api/notifications/dispatch|api/timing/watchdog|api/mcp|api/v2/invitations|icons|favicon|manifest|sw\\.js).*)",
  ],
};
