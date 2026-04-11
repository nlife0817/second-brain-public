import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const CF_EMAIL_HEADER = "cf-access-authenticated-user-email";

function isMobileUserAgent(ua: string): boolean {
  return /Mobile|Android|iPhone|iPad|iPod/i.test(ua);
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const cfEmail = request.headers.get(CF_EMAIL_HEADER);
  const devEmail = process.env.DEV_AUTH_EMAIL;

  // Block access only when: no CF header AND no DEV_AUTH_EMAIL fallback
  if (!cfEmail && !devEmail) {
    return new NextResponse("Access denied — Cloudflare Access required", {
      status: 401,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  // Mobile redirect for root path
  const ua = request.headers.get("user-agent") ?? "";
  if (
    pathname === "/" &&
    isMobileUserAgent(ua) &&
    !request.nextUrl.searchParams.has("desktop")
  ) {
    return NextResponse.redirect(new URL("/m/tasks", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    // Match all routes except Next.js internals, static files, and API init
    "/((?!_next|api/init|icons|favicon|manifest|sw\\.js).*)",
  ],
};
