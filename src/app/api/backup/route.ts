import { NextRequest, NextResponse } from "next/server";
import { listBackups, createBackup } from "@/lib/backup";
import { ensureDb } from "@/lib/db";
import { getAuthUser } from "@/lib/auth";

export async function GET(req: NextRequest) {
  const user = getAuthUser(req.headers);
  if (!user || user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  ensureDb();
  return NextResponse.json(listBackups());
}

export async function POST(req: NextRequest) {
  const user = getAuthUser(req.headers);
  if (!user || user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  try {
    ensureDb();
    const info = await createBackup();
    return NextResponse.json(info, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
