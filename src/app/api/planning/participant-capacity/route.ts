import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/api-auth";
import {
  listParticipantCapacities,
  upsertParticipantCapacity,
  listEffectiveCapacities,
} from "@/lib/db";

export const GET = withAuth(async (req: NextRequest) => {
  const periodId = req.nextUrl.searchParams.get("period_id");
  if (!periodId) {
    return NextResponse.json({ error: "period_id required" }, { status: 400 });
  }
  const effective = req.nextUrl.searchParams.get("effective") === "1";
  if (effective) {
    return NextResponse.json(await listEffectiveCapacities(periodId));
  }
  return NextResponse.json(await listParticipantCapacities(periodId));
});

export const PUT = withAuth(async (req: NextRequest) => {
  const body = await req.json().catch(() => null) as {
    participant_id?: string;
    period_id?: string;
    hours_override?: number | null;
    is_active_override?: boolean | null;
    note?: string | null;
  } | null;
  if (!body?.participant_id || !body?.period_id) {
    return NextResponse.json({ error: "participant_id and period_id required" }, { status: 400 });
  }
  const row = await upsertParticipantCapacity({
    participant_id: body.participant_id,
    period_id: body.period_id,
    hours_override: body.hours_override ?? null,
    is_active_override: body.is_active_override ?? null,
    note: body.note ?? null,
  });
  return NextResponse.json(row);
});
