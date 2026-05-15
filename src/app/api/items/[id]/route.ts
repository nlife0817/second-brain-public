import { NextRequest, NextResponse } from "next/server";
import { updateItem, deleteItem, getItemFull, setItemParticipants, setItemTags } from "@/lib/db";
import { UpdateItemPayload } from "@/types";
import { queueKaitenItemSync } from "@/lib/kaiten/sync";
import { getAuthUser } from "@/lib/auth";
import { sanitizeRichText } from "@/lib/sanitize";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const item = await getItemFull(id);
  if (!item) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(item);
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser();
  if (!user || user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  try {
    const { id } = await params;
    const body: UpdateItemPayload = await req.json();
    const hadParticipants = Array.isArray(body.participants);

    if (body.tags) {
      await setItemTags(id, body.tags);
      delete body.tags;
    }
    if (body.participants) {
      await setItemParticipants(id, body.participants);
      delete body.participants;
    }
    if (typeof body.description === "string") {
      body.description = sanitizeRichText(body.description);
    }

    const updated = await updateItem(id, body);
    if (!updated) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (hadParticipants || Object.keys(body).length > 0) {
      await queueKaitenItemSync(id);
    }

    return NextResponse.json(await getItemFull(id));
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser();
  if (!user || user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { id } = await params;
  const deleted = await deleteItem(id);
  if (!deleted) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
