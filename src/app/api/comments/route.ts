import { NextRequest, NextResponse } from "next/server";
import { getComments, createComment, updateComment, deleteComment } from "@/lib/db";
import type { EntityType } from "@/types";

export async function GET(req: NextRequest) {
  const entity_type = req.nextUrl.searchParams.get("entity_type") as EntityType | null;
  const entity_id = req.nextUrl.searchParams.get("entity_id");
  if (!entity_type || !entity_id) return NextResponse.json({ error: "entity_type and entity_id required" }, { status: 400 });
  return NextResponse.json(getComments(entity_type, entity_id));
}

export async function POST(req: Request) {
  const body = await req.json();
  const { entity_type, entity_id, text } = body;
  if (!entity_type || !entity_id || !text) {
    return NextResponse.json({ error: "entity_type, entity_id, text required" }, { status: 400 });
  }
  const comment = createComment({
    id: crypto.randomUUID(),
    entity_type,
    entity_id,
    text,
  });
  return NextResponse.json(comment, { status: 201 });
}

export async function PUT(req: Request) {
  const body = await req.json();
  const { id, text } = body;
  if (!id || text === undefined) return NextResponse.json({ error: "id and text required" }, { status: 400 });
  const updated = updateComment(id, text);
  if (!updated) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(updated);
}

export async function DELETE(req: Request) {
  const body = await req.json();
  const { id } = body;
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const ok = deleteComment(id);
  if (!ok) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ success: true });
}
