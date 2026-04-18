import { NextRequest, NextResponse } from "next/server";
import { getComments, createComment, updateComment, deleteComment } from "@/lib/db";
import { getAuthUser } from "@/lib/auth";
import type { EntityType } from "@/types";

export async function GET(req: NextRequest) {
  const entity_type = req.nextUrl.searchParams.get("entity_type") as EntityType | null;
  const entity_id = req.nextUrl.searchParams.get("entity_id");
  if (!entity_type || !entity_id) return NextResponse.json({ error: "entity_type and entity_id required" }, { status: 400 });
  return NextResponse.json(await getComments(entity_type, entity_id));
}

export async function POST(req: NextRequest) {
  const user = await getAuthUser();
  const body = await req.json();
  const { entity_type, entity_id, text } = body;
  if (!entity_type || !entity_id || !text) {
    return NextResponse.json({ error: "entity_type, entity_id, text required" }, { status: 400 });
  }
  const comment = await createComment({
    id: crypto.randomUUID(),
    entity_type,
    entity_id,
    text,
    author_email: user?.email || "",
  });
  return NextResponse.json(comment, { status: 201 });
}

export async function PUT(req: NextRequest) {
  const user = await getAuthUser();
  if (!user || user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const body = await req.json();
  const { id, text } = body;
  if (!id || text === undefined) return NextResponse.json({ error: "id and text required" }, { status: 400 });
  const updated = await updateComment(id, text);
  if (!updated) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(updated);
}

export async function DELETE(req: NextRequest) {
  const user = await getAuthUser();
  if (!user || user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const body = await req.json();
  const { id } = body;
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const ok = await deleteComment(id);
  if (!ok) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ success: true });
}
