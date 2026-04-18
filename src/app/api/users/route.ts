import { NextRequest, NextResponse } from "next/server";
import { getAllUsers, upsertUser } from "@/lib/db";
import { getAuthUser } from "@/lib/auth";
import type { UserRole } from "@/types";

export async function GET(_request: NextRequest) {
  const user = await getAuthUser();
  if (!user || user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const users = await getAllUsers();
  return NextResponse.json(users);
}

export async function POST(request: NextRequest) {
  const user = await getAuthUser();
  if (!user || user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json();
  const { email, role, name } = body as { email?: string; role?: UserRole; name?: string };

  if (!email || !email.includes("@")) {
    return NextResponse.json({ error: "Valid email is required" }, { status: 400 });
  }

  if (role && !["admin", "manager"].includes(role)) {
    return NextResponse.json({ error: "Role must be 'admin' or 'manager'" }, { status: 400 });
  }

  const created = await upsertUser(email.toLowerCase().trim(), role || "manager", name);
  return NextResponse.json(created, { status: 201 });
}
