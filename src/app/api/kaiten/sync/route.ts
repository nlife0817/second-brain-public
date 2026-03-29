import { NextResponse } from "next/server";
import { ensureKaitenSyncScheduler, runDueKaitenSync } from "@/lib/kaiten/sync";

export async function POST() {
  ensureKaitenSyncScheduler();
  const result = await runDueKaitenSync({ force: true });
  return NextResponse.json(result);
}
