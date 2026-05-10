import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth";
import { createRecurringSeriesFromItem, getItemFull } from "@/lib/db";
import { CreateRecurringSeriesPayload } from "@/types";

export async function POST(req: NextRequest) {
  const user = await getAuthUser();
  if (!user || user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  let body: CreateRecurringSeriesPayload;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body?.source_item_id || !body?.rule) {
    return NextResponse.json({ error: "source_item_id and rule are required" }, { status: 400 });
  }

  try {
    const { series, created_count } = await createRecurringSeriesFromItem(body.source_item_id, body.rule);
    const sourceItem = await getItemFull(body.source_item_id);
    return NextResponse.json({ series, created_count, source_item: sourceItem }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to create series";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
