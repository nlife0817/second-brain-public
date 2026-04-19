import { NextRequest, NextResponse } from "next/server";
import { getAllItemsFull, createItem, getItemFull, reorderItems, setItemParticipants, setItemTags } from "@/lib/db";
import { v4 as uuid } from "uuid";
import { CreateItemPayload } from "@/types";
import { queueKaitenItemSync } from "@/lib/kaiten/sync";
import { getAuthUser } from "@/lib/auth";

export async function GET(req: NextRequest) {
  const showArchived = req.nextUrl.searchParams.get("archived") === "true";
  const includeChildren = req.nextUrl.searchParams.get("children") === "true";

  return NextResponse.json(await getAllItemsFull(showArchived, includeChildren));
}

export async function POST(req: NextRequest) {
  const user = await getAuthUser();
  if (!user || user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  try {
    const body: CreateItemPayload = await req.json();

    if (!body.title?.trim()) {
      return NextResponse.json({ error: "Title is required" }, { status: 400 });
    }

    const item = await createItem({
      id: uuid(),
      title: body.title.trim(),
      description: body.description ?? "",
      type: body.type ?? "task",
      status: body.status ?? "inbox",
      priority: body.priority ?? "none",
      category: body.category ?? "other",
      source: body.source ?? "system",
      development_stage: body.development_stage ?? null,
      due_date: body.due_date ?? null,
      due_time: body.due_time ?? null,
      position: 0,
      parent_id: body.parent_id ?? null,
    });

    if (body.tags?.length) {
      await setItemTags(item.id, body.tags);
    }
    if (body.participants?.length) {
      await setItemParticipants(item.id, body.participants);
    }
    await queueKaitenItemSync(item.id);
    return NextResponse.json(await getItemFull(item.id), { status: 201 });
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
}

export async function PUT(req: NextRequest) {
  const user = await getAuthUser();
  if (!user || user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  try {
    const body: { items: { id: string; position: number; status?: string }[] } = await req.json();

    if (!body.items?.length) {
      return NextResponse.json({ error: "Items array required" }, { status: 400 });
    }

    await reorderItems(body.items);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
}
