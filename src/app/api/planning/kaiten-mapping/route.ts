import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/api-auth";
import { listBoardMappings, upsertBoardMapping, deleteBoardMapping } from "@/lib/db";

export const GET = withAuth(async () => {
  const rows = await listBoardMappings();
  return NextResponse.json(rows);
});

export const POST = withAuth(async (req: NextRequest) => {
  const body = await req.json();
  if (!body?.kaiten_board_id || !body?.initiative_id) {
    return NextResponse.json({ error: "kaiten_board_id and initiative_id required" }, { status: 400 });
  }
  const row = await upsertBoardMapping(String(body.kaiten_board_id), body.initiative_id);
  return NextResponse.json(row, { status: 201 });
});

export const DELETE = withAuth(async (req: NextRequest) => {
  const body = await req.json();
  if (!body?.kaiten_board_id) return NextResponse.json({ error: "kaiten_board_id required" }, { status: 400 });
  await deleteBoardMapping(String(body.kaiten_board_id));
  return NextResponse.json({ ok: true });
});
