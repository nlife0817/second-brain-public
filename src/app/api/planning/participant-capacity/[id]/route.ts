import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api-auth";
import { deleteParticipantCapacity } from "@/lib/db";

export const DELETE = withAuth(async (_req, ctx) => {
  const { id } = await ctx.params;
  const ok = await deleteParticipantCapacity(id);
  if (!ok) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
});
