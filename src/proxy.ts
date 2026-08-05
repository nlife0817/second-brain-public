import { NextResponse, type NextRequest } from "next/server";
import {
  SESSION_COOKIE,
  sessionCookieOptions,
  shouldRenew,
  signSession,
  toSessionUser,
  verifySessionPayload,
} from "@/lib/auth/session";

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
  if (project) {
    // ?task= сюда приводит ссылка на задачу (/v2/tasks/<id> редиректит в проект
    // задачи): без переноса параметра телефон открыл бы проект без карточки.
    const task = url.searchParams.get("task");
    return task
      ? `/v2/m/projects/${project[1]}?task=${encodeURIComponent(task)}`
      : `/v2/m/projects/${project[1]}`;
  }
  return null;
}

/** Липкий «режим полной версии»: сессионная cookie, ставится по ?desktop. */
const DESKTOP_COOKIE = "sb_desktop";

/** Показывать ли мобильные экраны: телефон и не включён режим полной версии. */
function wantsMobile(request: NextRequest): boolean {
  if (!isMobileUserAgent(request.headers.get("user-agent") ?? "")) return false;
  // ?desktop действует на всю сессию браузера, а не на один переход: иначе
  // администрирование в полной версии недостижимо с телефона — любой клик
  // по сайдбару снова уводил бы на /v2/m/*.
  if (request.nextUrl.searchParams.has("desktop")) return false;
  if (request.cookies.has(DESKTOP_COOKIE)) return false;
  return true;
}

/** Общий для dev-байпаса и обычного пути редирект мобильных UA. */
function mobileRedirect(request: NextRequest): NextResponse | null {
  if (!wantsMobile(request)) return null;
  const v2 = mobileV2Target(request.nextUrl);
  if (v2) return NextResponse.redirect(new URL(v2, request.url));
  return null;
}

/**
 * Куда ведёт старый адрес первой версии (десктопный путь; мобильный подберётся
 * следом). null — адрес к наследию отношения не имеет.
 *
 * Самих страниц в репозитории больше нет. Слой оставлен как совместимость:
 * на эти адреса указывают закладки, доставленные ранее push-уведомления
 * (`/?item=…`) и установленные на телефонах ярлыки старой PWA — без него они
 * упёрлись бы в 404.
 */
function legacyTarget(pathname: string): string | null {
  if (pathname === "/") return "/v2/my";
  if (pathname === "/timing") return "/v2/time";
  // Заметок в v2 нет — ведём в «Мои задачи».
  if (pathname === "/m" || pathname === "/m/tasks" || pathname === "/m/notes") return "/v2/my";
  if (pathname === "/m/inbox") return "/v2/inbox";
  if (pathname === "/m/timing") return "/v2/time";
  if (pathname === "/m/settings") return "/v2/settings";
  // Недельное планирование убрано вместе с остальным v1.
  if (pathname === "/planning" || pathname.startsWith("/planning/")) return "/v2/my";
  return null;
}

/**
 * Живые API приложения — всё остальное под `/api/` относится к первой версии.
 *
 * Кроме `/api/v2/*` сюда входит `/api/auth/*`: свой вход появился уже после
 * отключения v1 и к наследию отношения не имеет. Без этой оговорки `/api/auth/login`
 * отвечал бы 410 и войти было невозможно — ни на мобильной версии, ни на
 * десктопе (там ошибка не бросалась бы в глаза, пока жива cookie сессии).
 */
function isLiveApi(pathname: string): boolean {
  return (
    pathname.startsWith("/api/v2/") ||
    pathname === "/api/auth" ||
    pathname.startsWith("/api/auth/") ||
    // Адрес достался от интеграции первой версии, но живёт снова: теперь это
    // MCP-сервер v2 со своей проверкой токена (см. app/api/mcp/route.ts).
    pathname === "/api/mcp"
  );
}

/**
 * Отсечение старых адресов. Страницы — редирект в v2, API — 410 Gone.
 *
 * Проверка идёт до разрешения сессии: незачем ходить за пользователем ради
 * запроса, который всё равно будет перенаправлен.
 *
 * Под 410 попадают и внешние точки входа первой версии (`/api/cron/*`,
 * `/api/notifications/dispatch`, `/api/timing/watchdog`): их исключения убраны
 * из `config.matcher` вместе с самими роутами, так что отставшее расписание или
 * забытый клиент получат внятный ответ, а не 404. Адрес `/api/mcp` из этого
 * списка вышел — он снова живой, но уже как MCP-сервер v2.
 */
function legacyResponse(request: NextRequest): NextResponse | null {
  const { pathname } = request.nextUrl;

  if (pathname.startsWith("/api/") && !isLiveApi(pathname)) {
    return NextResponse.json(
      { error: "API v1 отключён — используйте /api/v2/*" },
      { status: 410 },
    );
  }

  const target = legacyTarget(pathname);
  if (!target) return null;

  // Параметры переносим: push-уведомления несут ?task=<id>.
  const desktopUrl = new URL(target, request.url);
  desktopUrl.search = request.nextUrl.search;
  const mobile = wantsMobile(request) ? mobileV2Target(desktopUrl) : null;
  if (!mobile) return NextResponse.redirect(desktopUrl);

  const mobileUrl = new URL(mobile, request.url);
  // mobileV2Target сам переносит ?task=…; остальные параметры — здесь.
  if (!mobileUrl.search) mobileUrl.search = request.nextUrl.search;
  return NextResponse.redirect(mobileUrl);
}

/** Проставляет/снимает cookie режима полной версии по ?desktop / ?mobile. */
function applyDesktopModeCookie(request: NextRequest, response: NextResponse): void {
  if (request.nextUrl.searchParams.has("desktop")) {
    response.cookies.set(DESKTOP_COOKIE, "1", { path: "/", sameSite: "lax" });
  } else if (request.nextUrl.searchParams.has("mobile")) {
    response.cookies.delete(DESKTOP_COOKIE);
  }
}

// /invite/* открыт до входа: страница либо заводит учётку с паролем, либо ведёт
// на вход с возвратом. /set-password/* — установка пароля по одноразовой ссылке:
// сюда приходит именно тот, кто войти пока не может. /api/auth/* — сам вход.
const PUBLIC_PATHS = ["/login", "/api/auth", "/invite", "/set-password"];

// Local-only dev bypass. Active iff both conditions hold:
//   1) NODE_ENV !== "production"  (production builds always set this to "production")
//   2) DEV_USER_EMAIL env var is set
// When active, proxy skips the session check and treats every request as
// authenticated. getAuthUser() also honors this env var to return a real DB user row.
const DEV_BYPASS_ACTIVE =
  process.env.NODE_ENV !== "production" && !!process.env.DEV_USER_EMAIL;

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // v1 отключён — до разрешения сессии, чтобы не ходить за пользователем ради
  // запроса, который всё равно уедет в v2.
  const legacy = legacyResponse(request);
  if (legacy) return legacy;

  // Раньше здесь было `let`: клиент Supabase переприсваивал ответ в setAll,
  // дописывая обновлённые cookie. Своей сессии это не нужно — она подписана и
  // продлевается одной записью cookie ниже.
  const response = NextResponse.next({ request });

  if (DEV_BYPASS_ACTIVE) {
    const redirected = mobileRedirect(request);
    if (redirected) return redirected;
    applyDesktopModeCookie(request, response);
    return response;
  }

  // Проверка подписи cookie — локальная, без сетевых вызовов (см. lib/auth/session.ts).
  const session = await verifySessionPayload(request.cookies.get(SESSION_COOKIE)?.value);

  const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));

  if (!session && !isPublic) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  // Мобильные UA: десктопные экраны → /v2/m/*
  // (только для авторизованных; обход — ?desktop, возврат — ?mobile).
  if (session) {
    const redirect = mobileRedirect(request);
    if (redirect) return redirect;

    // Продление на подходе к концу срока: иначе активный пользователь ровно
    // через 30 дней оказался бы на экране входа посреди работы. Ставим cookie
    // только на «остающемся» ответе — на редиректе выше она бы потерялась.
    if (shouldRenew(session)) {
      const renewed = await signSession(toSessionUser(session));
      response.cookies.set(SESSION_COOKIE, renewed, sessionCookieOptions());
    }
  }

  applyDesktopModeCookie(request, response);
  return response;
}

export const config = {
  matcher: [
    // api/v2/invitations исключён: GET показывает приглашение до входа, POST
    // сам требует сессию через withUser.
    // api/mcp — вход внешних агентов по токену: сессии-cookie у них нет, и без
    // исключения запрос уехал бы редиректом на /login.
    // api/v2/telegram/webhook — апдейты от Bot API: запрос делает телеграм, а
    // не браузер. Свою проверку роут делает сам (секрет в заголовке).
    "/((?!_next|api/v2/cron|api/v2/invitations|api/v2/telegram/webhook|api/mcp|icons|favicon|manifest|sw\\.js|offline\\.html).*)",
  ],
};
