import { NextRequest, NextResponse } from "next/server";
import { deleteStagingBatch, getAllStagingItems } from "@/lib/db";

export async function DELETE(req: NextRequest) {
  const batchId = req.nextUrl.searchParams.get("batchId");
  if (!batchId) return NextResponse.json({ error: "batchId required" }, { status: 400 });
  await deleteStagingBatch(batchId);
  return NextResponse.json({ ok: true });
}

export async function GET(req: NextRequest) {
  const status = req.nextUrl.searchParams.get("status") as "pending" | "approved" | "rejected" | null;
  const items = await getAllStagingItems(status ?? undefined);

  const batches: Record<string, typeof items> = {};
  for (const item of items) {
    if (!batches[item.batch_id]) batches[item.batch_id] = [];
    batches[item.batch_id].push(item);
  }
  return NextResponse.json(batches);
}
