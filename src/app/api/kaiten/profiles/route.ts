import { NextRequest, NextResponse } from "next/server";
import { getAllSyncProfiles, getIntegrationSettings, getIntegrationToken, upsertSyncProfile } from "@/lib/db";
import { getLatestKaitenImport } from "@/lib/kaiten/import";
import { refreshKaitenCatalogForProfile } from "@/lib/kaiten/sync";

export async function GET() {
  const profiles = await getAllSyncProfiles("kaiten");
  const withImports = await Promise.all(
    profiles.map(async (profile) => ({
      ...profile,
      last_import: await getLatestKaitenImport(profile.id),
    }))
  );
  return NextResponse.json(withImports);
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const savedProfile = await upsertSyncProfile("kaiten", {
      id: body.id,
      name: body.name ?? "Kaiten import",
      entity_type: "item",
      source_space_id: body.source_space_id ?? null,
      source_board_id: body.source_board_id ?? null,
      import_enabled: body.import_enabled !== false,
      export_enabled: body.export_enabled !== false,
      sync_interval_minutes: body.sync_interval_minutes ?? 60,
      remote_wins_on_conflict: body.remote_wins_on_conflict !== false,
      source_statuses: Array.isArray(body.source_statuses) ? body.source_statuses.map(String) : [],
      source_columns: Array.isArray(body.source_columns) ? body.source_columns.map(String) : [],
      source_lanes: Array.isArray(body.source_lanes) ? body.source_lanes.map(String) : [],
    });
    const settings = await getIntegrationSettings("kaiten");
    const token = await getIntegrationToken("kaiten");
    const profile =
      settings.company_domain && token && savedProfile.source_space_id
        ? await refreshKaitenCatalogForProfile(savedProfile.id).catch(() => savedProfile)
        : savedProfile;
    return NextResponse.json({
      ...profile,
      last_import: await getLatestKaitenImport(profile.id),
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to save sync profile",
      },
      { status: 400 }
    );
  }
}
