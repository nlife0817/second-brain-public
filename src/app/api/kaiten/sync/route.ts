import { NextResponse } from "next/server";
import { runDueKaitenSync } from "@/lib/kaiten/sync";

export async function POST() {
  const result = await runDueKaitenSync({ force: true });
  return NextResponse.json(result);
}
