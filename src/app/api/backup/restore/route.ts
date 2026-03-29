import { NextRequest, NextResponse } from "next/server";
import { restoreFromBackup } from "@/lib/backup";
import { ensureDb, resetDb } from "@/lib/db";

function reinitDb() {
  ensureDb();
}

export async function POST(req: NextRequest) {
  try {
    ensureDb();
    const { filename } = await req.json();
    if (!filename || typeof filename !== "string") {
      return NextResponse.json({ error: "filename is required" }, { status: 400 });
    }
    restoreFromBackup(filename, resetDb, reinitDb);
    return NextResponse.json({ ok: true, restored: filename });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const status = msg.includes("not found") ? 404 : msg.includes("Invalid") ? 400 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
