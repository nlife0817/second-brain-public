import { NextRequest, NextResponse } from "next/server";
import { getIntegrationSettings, getIntegrationToken } from "@/lib/db";
import { createKaitenClient, KaitenApiError } from "@/lib/kaiten/client";

export async function GET(req: NextRequest) {
  const settings = getIntegrationSettings("kaiten");
  const token = getIntegrationToken("kaiten");
  const spaceIdParam = req.nextUrl.searchParams.get("space_id");

  if (!settings.company_domain || !token) {
    return NextResponse.json({ spaces: [], boards: [] });
  }

  try {
    const client = createKaitenClient({ baseUrl: settings.api_base_url, token });
    const spaces = await client.getSpaces();
    const selectedSpaceId = spaceIdParam ? Number(spaceIdParam) : spaces[0]?.id;
    const boards = selectedSpaceId ? await client.getBoards(selectedSpaceId) : [];
    return NextResponse.json({ spaces, boards, selected_space_id: selectedSpaceId ?? null });
  } catch (error) {
    const status = error instanceof KaitenApiError ? error.status : 500;
    const message = error instanceof Error ? error.message : "Failed to load Kaiten boards";
    return NextResponse.json({ error: message }, { status });
  }
}
