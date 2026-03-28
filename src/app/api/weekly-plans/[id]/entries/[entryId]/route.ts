import { NextRequest, NextResponse } from "next/server";
import { updatePlanEntry } from "@/lib/db";

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string; entryId: string }> }) {
  try {
    const { entryId } = await params;
    const body = await req.json();

    const updated = updatePlanEntry(entryId, {
      result_status: body.result_status,
      result_comment: body.result_comment,
      position: body.position,
    });

    if (!updated) return NextResponse.json({ error: "Entry not found" }, { status: 404 });
    return NextResponse.json(updated);
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
}
