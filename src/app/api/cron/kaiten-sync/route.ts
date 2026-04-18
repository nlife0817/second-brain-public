import { NextRequest, NextResponse } from "next/server";
import { runDueKaitenSync } from "@/lib/kaiten/sync";

// Vercel Cron automatically sets the Authorization header with CRON_SECRET
// (see https://vercel.com/docs/cron-jobs/manage-cron-jobs#securing-cron-jobs).
function isAuthorized(req: NextRequest): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return true; // No secret configured → allow (dev mode).
  const header = req.headers.get("authorization");
  return header === `Bearer ${expected}`;
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const force = req.nextUrl.searchParams.get("force") === "true";
    const result = await runDueKaitenSync({ force });
    return NextResponse.json({ ok: true, result });
  } catch (e) {
    console.error("[cron/kaiten-sync] failed:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Sync failed" },
      { status: 500 }
    );
  }
}
