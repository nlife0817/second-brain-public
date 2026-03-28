import { NextRequest, NextResponse } from "next/server";
import { getAllItems, createItem, getSubtasks, getItemTags, reorderItems } from "@/lib/db";
import { v4 as uuid } from "uuid";
import { CreateItemPayload, ItemWithSubtasks } from "@/types";

export async function GET(req: NextRequest) {
  const showArchived = req.nextUrl.searchParams.get("archived") === "true";
  const includeChildren = req.nextUrl.searchParams.get("children") === "true";
  const items = getAllItems(showArchived, includeChildren);

  const itemsWithSubtasks: ItemWithSubtasks[] = items.map((item) => ({
    ...item,
    subtasks: getSubtasks(item.id),
    tags: getItemTags(item.id),
  }));

  return NextResponse.json(itemsWithSubtasks);
}

export async function POST(req: NextRequest) {
  const body: CreateItemPayload = await req.json();

  if (!body.title?.trim()) {
    return NextResponse.json({ error: "Title is required" }, { status: 400 });
  }

  const item = createItem({
    id: uuid(),
    title: body.title.trim(),
    description: body.description ?? "",
    type: body.type ?? "task",
    status: body.status ?? "inbox",
    priority: body.priority ?? "none",
    category: body.category ?? "other",
    due_date: body.due_date ?? null,
    position: 0,
    parent_id: body.parent_id ?? null,
  });

  return NextResponse.json(item, { status: 201 });
}

export async function PUT(req: NextRequest) {
  const body: { items: { id: string; position: number; status?: string }[] } = await req.json();

  if (!body.items?.length) {
    return NextResponse.json({ error: "Items array required" }, { status: 400 });
  }

  reorderItems(body.items);
  return NextResponse.json({ ok: true });
}
