import { NextRequest, NextResponse } from "next/server";
import { getUserByEmail, upsertUser, deleteUser } from "@/lib/db";
import { getAuthUser } from "@/lib/auth";
import type { UserRole } from "@/types";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ email: string }> }
) {
  const user = await getAuthUser();
  if (!user || user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { email } = await params;
  const target = await getUserByEmail(decodeURIComponent(email));
  if (!target) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }
  return NextResponse.json(target);
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ email: string }> }
) {
  const user = await getAuthUser();
  if (!user || user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { email } = await params;
  const decodedEmail = decodeURIComponent(email);
  const existing = await getUserByEmail(decodedEmail);
  if (!existing) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const body = await request.json();
  const { role, name } = body as { role?: UserRole; name?: string };

  if (role && !["admin", "manager"].includes(role)) {
    return NextResponse.json({ error: "Role must be 'admin' or 'manager'" }, { status: 400 });
  }

  const updated = await upsertUser(
    decodedEmail,
    role || existing.role,
    name !== undefined ? name : existing.name
  );
  return NextResponse.json(updated);
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ email: string }> }
) {
  const user = await getAuthUser();
  if (!user || user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { email } = await params;
  const decodedEmail = decodeURIComponent(email);

  // Cannot delete yourself
  if (decodedEmail === user.email) {
    return NextResponse.json({ error: "Cannot delete yourself" }, { status: 400 });
  }

  const deleted = await deleteUser(decodedEmail);
  if (!deleted) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }
  return NextResponse.json({ success: true });
}
