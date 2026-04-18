import { NextRequest, NextResponse } from "next/server";
import { getIntegrationSettings, upsertIntegrationSettings } from "@/lib/db";

export async function GET() {
  return NextResponse.json(await getIntegrationSettings("kaiten"));
}

export async function PUT(req: NextRequest) {
  try {
    const body = await req.json();
    const settings = await upsertIntegrationSettings("kaiten", {
      enabled: !!body.enabled,
      company_domain: body.company_domain ?? "",
      token: typeof body.token === "string" ? body.token : undefined,
      clear_token: !!body.clear_token,
      default_import_target: "staging",
    });
    return NextResponse.json(settings);
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to save Kaiten settings",
      },
      { status: 400 }
    );
  }
}
