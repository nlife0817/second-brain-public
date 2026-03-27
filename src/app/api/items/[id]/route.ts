import { NextRequest, NextResponse } from "next/server";
import { getItemById, updateItem, deleteItem, getSubtasks, getItemTags, setItemTags } from "@/lib/db";
import { UpdateItemPayload, ItemWithSubtasks } from "@/types";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const item = getItemById(id);
  if (!item) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const result: ItemWithSubtasks = {
    ...item,
    subtasks: getSubtasks(item.id),
    tags: getItemTags(item.id),
  };

  return NextResponse.json(result);
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body: UpdateItemPayload = await req.json();

  if (body.tags) {
    setItemTags(id, body.tags);
    delete body.tags;
  }

  const updated = updateItem(id, body);
  if (!updated) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const result: ItemWithSubtasks = {
    ...updated,
    subtasks: getSubtasks(updated.id),
    tags: getItemTags(updated.id),
  };

  return NextResponse.json(result);
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const deleted = deleteItem(id);
  if (!deleted) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
