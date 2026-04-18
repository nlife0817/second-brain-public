import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

function isMobileUserAgent(ua: string): boolean {
  return /Mobile|Android|iPhone|iPad|iPod/i.test(ua);
}

const PUBLIC_PATHS = ["/login", "/auth/callback"];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  let response = NextResponse.next({ request });

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

  // Refresh session cookies.
  const { data: { user } } = await supabase.auth.getUser();

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
    "/((?!_next|api/init|api/cron|icons|favicon|manifest|sw\\.js).*)",
  ],
};
