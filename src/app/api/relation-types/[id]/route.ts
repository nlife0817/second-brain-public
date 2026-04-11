import { NextResponse } from "next/server";
import { updateRelationType, deleteRelationType } from "@/lib/db";

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  const updated = updateRelationType(id, body);
  if (!updated) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(updated);
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = deleteRelationType(id);
  if (result === "system") return NextResponse.json({ error: "Системный тип связи нельзя удалить" }, { status: 403 });
  if (!result) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ success: true });
}
