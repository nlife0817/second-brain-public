import { NextRequest, NextResponse } from "next/server";
import { getSyncFieldMappings, replaceSyncFieldMappings } from "@/lib/db";
import { KAITEN_DEFAULT_FIELD_MAPPINGS } from "@/types";

export async function GET(req: NextRequest) {
  const profileId = req.nextUrl.searchParams.get("profile_id");
  if (!profileId) {
    return NextResponse.json({
      defaults: KAITEN_DEFAULT_FIELD_MAPPINGS,
      mappings: [],
    });
  }

  return NextResponse.json({
    defaults: KAITEN_DEFAULT_FIELD_MAPPINGS,
    mappings: getSyncFieldMappings(profileId),
  });
}

export async function PUT(req: NextRequest) {
  try {
    const body = await req.json();
    if (!body.profile_id) {
      return NextResponse.json({ error: "profile_id is required" }, { status: 400 });
    }
    const mappings = replaceSyncFieldMappings(
      body.profile_id,
      Array.isArray(body.mappings) ? body.mappings : []
    );
    return NextResponse.json({
      defaults: KAITEN_DEFAULT_FIELD_MAPPINGS,
      mappings,
    });
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
}
