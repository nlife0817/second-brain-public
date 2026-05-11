import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api-auth";
import { listItemPlanHistory } from "@/lib/db";

export const GET = withAuth(async (_req, ctx) => {
  const { id } = await ctx.params;
  const rows = await listItemPlanHistory(id);
  return NextResponse.json(rows);
});
