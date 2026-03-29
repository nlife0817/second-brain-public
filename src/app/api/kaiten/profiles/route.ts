import { NextRequest, NextResponse } from "next/server";
import { getAllSyncProfiles, upsertSyncProfile } from "@/lib/db";
import { getLatestKaitenImport } from "@/lib/kaiten/import";

export async function GET() {
  const profiles = getAllSyncProfiles("kaiten");
  return NextResponse.json(
    profiles.map((profile) => ({
      ...profile,
      last_import: getLatestKaitenImport(profile.id),
    }))
  );
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const profile = upsertSyncProfile("kaiten", {
      id: body.id,
      name: body.name ?? "Kaiten import",
      entity_type: "item",
      source_space_id: body.source_space_id ?? null,
      source_board_id: body.source_board_id ?? null,
      import_enabled: body.import_enabled !== false,
      export_enabled: !!body.export_enabled,
      source_statuses: Array.isArray(body.source_statuses) ? body.source_statuses.map(String) : [],
      source_columns: Array.isArray(body.source_columns) ? body.source_columns.map(String) : [],
      source_lanes: Array.isArray(body.source_lanes) ? body.source_lanes.map(String) : [],
    });
    return NextResponse.json({
      ...profile,
      last_import: getLatestKaitenImport(profile.id),
    });
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
}
