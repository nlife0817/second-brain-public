import { NextResponse } from "next/server";
import { ensureKaitenSyncScheduler, runDueKaitenSync } from "@/lib/kaiten/sync";

export async function POST() {
  ensureKaitenSyncScheduler();
  const result = await runDueKaitenSync();
  return NextResponse.json(result);
}
