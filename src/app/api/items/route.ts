import { NextRequest, NextResponse } from "next/server";
import { getAllItemsFull, createItem, getItemTags, reorderItems, setItemParticipants, setItemTags, autoLinkOrphanTaskToSupport } from "@/lib/db";
import { v4 as uuid } from "uuid";
import { CreateItemPayload, ItemWithSubtasks } from "@/types";
import { queueKaitenItemSync } from "@/lib/kaiten/sync";
import { getAuthUser } from "@/lib/auth";
import { sanitizeRichText } from "@/lib/sanitize";

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
      description: sanitizeRichText(body.description ?? ""),
      type: body.type ?? "task",
      status: body.status ?? "inbox",
      priority: body.priority ?? "none",
      category: body.category ?? "other",
      source: body.source ?? "system",
      development_stage: body.development_stage ?? null,
      due_date: body.due_date ?? null,
      due_time: body.due_time ?? null,
      estimated_minutes: body.estimated_minutes ?? null,
      position: 0,
      parent_id: body.parent_id ?? null,
    });

    // Run tags + participants in parallel; new items have no subtasks.
    const [tags, participants] = await Promise.all([
      body.tags?.length
        ? setItemTags(item.id, body.tags).then(() => getItemTags(item.id))
        : Promise.resolve([]),
      body.participants?.length
        ? setItemParticipants(item.id, body.participants)
        : Promise.resolve([]),
    ]);

    // Kaiten sync is a background queue op — don't block the response.
    if (item.category === "development" || body.parent_id) {
      void queueKaitenItemSync(item.id).catch((err) => {
        console.error("queueKaitenItemSync failed", err);
      });
    }

    // Auto-link orphan task to current Support Qx initiative (concept §6.3).
    // Only for top-level tasks without explicit initiative attribution.
    if (item.type === "task" && !body.parent_id) {
      void autoLinkOrphanTaskToSupport(item.id).catch((err) => {
        console.error("autoLinkOrphanTaskToSupport failed", err);
      });
    }

    const full: ItemWithSubtasks = { ...item, subtasks: [], tags, participants };
    return NextResponse.json(full, { status: 201 });
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
