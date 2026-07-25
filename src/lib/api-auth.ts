import { NextRequest, NextResponse } from "next/server";
import { getAuthUser, type AuthUser } from "./auth";
import type { UserRole } from "@/types";

type RouteHandler = (request: NextRequest, context: { params: Promise<Record<string, string>> }) => Promise<NextResponse>;
type AuthenticatedHandler = (request: NextRequest, context: { params: Promise<Record<string, string>> }, user: AuthUser) => Promise<NextResponse>;

export function withAuth(handler: AuthenticatedHandler, requiredRole?: UserRole): RouteHandler {
  return async (request, context) => {
    const user = await getAuthUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (requiredRole && user.role !== requiredRole) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    return handler(request, context, user);
  };
}

export function withAdminOnly(handler: AuthenticatedHandler): RouteHandler {
  return withAuth(handler, "admin");
}
