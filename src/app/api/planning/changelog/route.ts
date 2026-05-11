import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/api-auth";
import { listChangeLog } from "@/lib/db";

export const GET = withAuth(async (req: NextRequest) => {
  const url = new URL(req.url);
  const filter = {
    entityType: url.searchParams.get("entity_type") ?? undefined,
    entityId: url.searchParams.get("entity_id") ?? undefined,
    actorEmail: url.searchParams.get("actor_email") ?? undefined,
    from: url.searchParams.get("from") ?? undefined,
    to: url.searchParams.get("to") ?? undefined,
  };
  const limit = Number(url.searchParams.get("limit") ?? "100");
  const offset = Number(url.searchParams.get("offset") ?? "0");
  const rows = await listChangeLog(filter, limit, offset);
  return NextResponse.json(rows);
});
