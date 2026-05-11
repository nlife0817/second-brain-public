import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/api-auth";
import { getPlanningSettings, updatePlanningSettings } from "@/lib/db";

export const GET = withAuth(async () => {
  const row = await getPlanningSettings();
  return NextResponse.json(row);
});

export const PATCH = withAuth(async (req: NextRequest) => {
  const body = await req.json();
  const row = await updatePlanningSettings(body);
  return NextResponse.json(row);
});
