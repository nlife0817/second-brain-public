import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/api-auth";
import { listPeriods, upsertPeriod } from "@/lib/db";
import { logChange } from "@/lib/planning-changelog";
import type { PeriodType } from "@/types/planning";

export const GET = withAuth(async (req: NextRequest) => {
  const url = new URL(req.url);
  const directionParam = url.searchParams.get("direction_id");
  const typeParam = url.searchParams.get("type") as PeriodType | null;
  const yearParam = url.searchParams.get("year");
  const filter: { directionId?: string | null; type?: PeriodType; year?: number } = {};
  if (directionParam !== null) {
    filter.directionId = directionParam === "null" ? null : directionParam;
  }
  if (typeParam) filter.type = typeParam;
  if (yearParam) filter.year = Number(yearParam);
  const rows = await listPeriods(filter);
  return NextResponse.json(rows);
});

export const POST = withAuth(async (req: NextRequest, _ctx, user) => {
  const body = await req.json();
  if (!body?.type || !body?.year || !body?.start_date || !body?.end_date) {
    return NextResponse.json({ error: "type, year, start_date, end_date are required" }, { status: 400 });
  }
  const row = await upsertPeriod(body);
  await logChange({
    actor_email: user.email,
    entity_type: "period",
    entity_id: row.id,
    action: "upsert",
    diff: { type: { from: null, to: row.type }, year: { from: null, to: row.year } },
  });
  return NextResponse.json(row, { status: 201 });
});
