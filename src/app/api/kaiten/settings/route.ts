import { NextRequest, NextResponse } from "next/server";
import { getIntegrationSettings, upsertIntegrationSettings } from "@/lib/db";
import { ensureKaitenSyncScheduler } from "@/lib/kaiten/sync";

export async function GET() {
  ensureKaitenSyncScheduler();
  return NextResponse.json(getIntegrationSettings("kaiten"));
}

export async function PUT(req: NextRequest) {
  try {
    ensureKaitenSyncScheduler();
    const body = await req.json();
    const settings = upsertIntegrationSettings("kaiten", {
      enabled: !!body.enabled,
      company_domain: body.company_domain ?? "",
      token: typeof body.token === "string" ? body.token : undefined,
      clear_token: !!body.clear_token,
      default_import_target: "staging",
    });
    return NextResponse.json(settings);
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
}
