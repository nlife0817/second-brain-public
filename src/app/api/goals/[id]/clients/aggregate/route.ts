import { NextRequest, NextResponse } from "next/server";
import { getClientRevenueAggregate } from "@/lib/db";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const data = await getClientRevenueAggregate(id);
  return NextResponse.json(data);
}
