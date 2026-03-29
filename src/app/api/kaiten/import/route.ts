import { NextRequest, NextResponse } from "next/server";
import { importKaitenProfile } from "@/lib/kaiten/import";
import { KaitenApiError } from "@/lib/kaiten/client";
import { ensureKaitenSyncScheduler } from "@/lib/kaiten/sync";

export async function POST(req: NextRequest) {
  try {
    ensureKaitenSyncScheduler();
    const body = await req.json();
    if (!body.profile_id) {
      return NextResponse.json({ error: "profile_id is required" }, { status: 400 });
    }
    const result = await importKaitenProfile(String(body.profile_id));
    return NextResponse.json(result);
  } catch (error) {
    const status = error instanceof KaitenApiError ? error.status : 500;
    const message = error instanceof Error ? error.message : "Failed to import from Kaiten";
    return NextResponse.json({ error: message }, { status });
  }
}
