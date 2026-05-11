import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api-auth";
import { getPeriod } from "@/lib/db";

export const GET = withAuth(async (_req, ctx) => {
  const { id } = await ctx.params;
  const row = await getPeriod(id);
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(row);
});
