import { NextRequest, NextResponse } from "next/server";
import { updateItem, deleteItem, getItemFull, setItemParticipants, setItemTags } from "@/lib/db";
import { UpdateItemPayload } from "@/types";
import { ensureKaitenSyncScheduler, queueKaitenItemSync } from "@/lib/kaiten/sync";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  ensureKaitenSyncScheduler();
  const { id } = await params;
  const item = getItemFull(id);
  if (!item) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(item);
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    ensureKaitenSyncScheduler();
    const { id } = await params;
    const body: UpdateItemPayload = await req.json();
    const hadParticipants = Array.isArray(body.participants);

    if (body.tags) {
      setItemTags(id, body.tags);
      delete body.tags;
    }
    if (body.participants) {
      setItemParticipants(id, body.participants);
      delete body.participants;
    }

    const updated = updateItem(id, body);
    if (!updated) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (hadParticipants || Object.keys(body).length > 0) {
      queueKaitenItemSync(id);
    }

    return NextResponse.json(getItemFull(id));
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  ensureKaitenSyncScheduler();
  const { id } = await params;
  const deleted = deleteItem(id);
  if (!deleted) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
