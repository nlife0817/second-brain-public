import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const CF_EMAIL_HEADER = "cf-access-authenticated-user-email";

export function middleware(request: NextRequest) {
  // In development — pass through (auth handled by DEV_AUTH_EMAIL env)
  if (process.env.NODE_ENV === "development") {
    return NextResponse.next();
  }

  // In production — check that Cloudflare Access header is present
  const email = request.headers.get(CF_EMAIL_HEADER);
  if (!email) {
    return new NextResponse("Access denied — Cloudflare Access required", {
      status: 401,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    // Match all routes except Next.js internals, static files, and API init
    "/((?!_next|api/init|icons|favicon|manifest|sw\\.js).*)",
  ],
};
