import { NextRequest, NextResponse } from "next/server";
import { bulkAddItemsToPlan, removeItemFromPlan } from "@/lib/db";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: planId } = await params;
    const body = await req.json();
    const itemIds: string[] = body.itemIds;

    if (!itemIds?.length) {
      return NextResponse.json({ error: "itemIds array is required" }, { status: 400 });
    }

    const added = await bulkAddItemsToPlan(planId, itemIds);
    return NextResponse.json({ ok: true, added }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: planId } = await params;
    const body = await req.json();
    const itemId: string = body.itemId;

    if (!itemId) {
      return NextResponse.json({ error: "itemId is required" }, { status: 400 });
    }

    const removed = await removeItemFromPlan(planId, itemId);
    if (!removed) return NextResponse.json({ error: "Entry not found" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
}
