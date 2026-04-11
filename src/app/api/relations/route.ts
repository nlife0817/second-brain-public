import { NextRequest, NextResponse } from "next/server";
import { getRelationsForEntity, createRelation, updateRelation, deleteRelation } from "@/lib/db";
import type { EntityType } from "@/types";
import { getAuthUser } from "@/lib/auth";

export async function GET(req: NextRequest) {
  const entity_type = req.nextUrl.searchParams.get("entity_type") as EntityType | null;
  const entity_id = req.nextUrl.searchParams.get("entity_id");
  if (!entity_type || !entity_id) return NextResponse.json({ error: "entity_type and entity_id required" }, { status: 400 });
  return NextResponse.json(getRelationsForEntity(entity_type, entity_id));
}

export async function POST(req: NextRequest) {
  const user = getAuthUser(req.headers);
  if (!user || user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const body = await req.json();
  const { source_type, source_id, target_type, target_id, relation_type_id } = body;
  if (!source_type || !source_id || !target_type || !target_id) {
    return NextResponse.json({ error: "source and target required" }, { status: 400 });
  }
  const relation = createRelation({
    id: crypto.randomUUID(),
    source_type,
    source_id,
    target_type,
    target_id,
    relation_type_id: relation_type_id ?? null,
  });
  if (!relation) return NextResponse.json({ error: "relation already exists" }, { status: 409 });
  return NextResponse.json(relation, { status: 201 });
}

export async function PUT(req: NextRequest) {
  const user = getAuthUser(req.headers);
  if (!user || user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const body = await req.json();
  const { id, relation_type_id } = body;
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const updated = updateRelation(id, { relation_type_id });
  if (!updated) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(updated);
}

export async function DELETE(req: NextRequest) {
  const user = getAuthUser(req.headers);
  if (!user || user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const body = await req.json();
  const { id } = body;
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const ok = deleteRelation(id);
  if (!ok) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ success: true });
}
