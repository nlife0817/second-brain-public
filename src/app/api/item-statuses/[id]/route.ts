import { NextRequest, NextResponse } from "next/server";
import { updateItemStatus, deleteItemStatus } from "@/lib/db";
import { getAuthUser } from "@/lib/auth";

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser();
  if (!user || user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { id } = await params;
  try {
    const body = await req.json();
    const updates: Record<string, unknown> = {};
    if (typeof body.name === "string") updates.name = body.name.trim();
    if (typeof body.color === "string") updates.color = body.color;
    if (typeof body.position === "number") updates.position = body.position;
    if (body.kind === "open" || body.kind === "done" || body.kind === "archived") {
      updates.kind = body.kind;
    }
    const updated = await updateItemStatus(id, updates);
    if (!updated) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(updated);
  } catch {
    return NextResponse.json({ error: "Failed to update" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser();
  if (!user || user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { id } = await params;
  const result = await deleteItemStatus(id);
  if (!result.ok) {
    if (result.reason === "in_use") {
      return NextResponse.json(
        {
          error: "in_use",
          message: `Статус используется в ${result.inUseCount} задачах. Сначала переведите их в другой статус.`,
          inUseCount: result.inUseCount,
        },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
