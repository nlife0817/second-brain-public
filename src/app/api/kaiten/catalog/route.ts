import { NextRequest, NextResponse } from "next/server";
import { getAllSyncProfiles, getKaitenSyncCatalog } from "@/lib/db";
import { ensureKaitenSyncScheduler, refreshKaitenCatalogForProfile } from "@/lib/kaiten/sync";

export async function GET(req: NextRequest) {
  ensureKaitenSyncScheduler();

  const refresh = req.nextUrl.searchParams.get("refresh") === "true";
  const profileId = req.nextUrl.searchParams.get("profile_id");

  if (refresh) {
    if (profileId) {
      await refreshKaitenCatalogForProfile(profileId).catch(() => null);
    } else {
      const profiles = getAllSyncProfiles("kaiten");
      await Promise.all(
        profiles.map((profile) =>
          refreshKaitenCatalogForProfile(profile.id).catch(() => null)
        )
      );
    }
  }

  return NextResponse.json(getKaitenSyncCatalog());
}
