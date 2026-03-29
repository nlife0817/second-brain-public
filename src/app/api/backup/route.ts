import { NextResponse } from "next/server";
import { listBackups, createBackup } from "@/lib/backup";
import { ensureDb } from "@/lib/db";

export async function GET() {
  ensureDb();
  return NextResponse.json(listBackups());
}

export async function POST() {
  try {
    ensureDb();
    const info = await createBackup();
    return NextResponse.json(info, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
