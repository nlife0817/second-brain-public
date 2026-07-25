import { NextResponse } from "next/server";
import { getIntegrationSettings, getIntegrationToken } from "@/lib/db";
import { createKaitenClient, KaitenApiError } from "@/lib/kaiten/client";

export async function POST() {
  const settings = await getIntegrationSettings("kaiten");
  const token = await getIntegrationToken("kaiten");

  try {
    const client = createKaitenClient({ baseUrl: settings.api_base_url, token });
    const spaces = await client.testConnection();
    return NextResponse.json({ ok: true, spaces_count: spaces.length });
  } catch (error) {
    const status = error instanceof KaitenApiError ? error.status : 500;
    const message = error instanceof Error ? error.message : "Failed to connect to Kaiten";
    return NextResponse.json({ error: message }, { status });
  }
}
