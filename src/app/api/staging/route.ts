import { NextRequest, NextResponse } from "next/server";
import { getAllStagingItems, createStagingItem } from "@/lib/db";
import { v4 as uuid } from "uuid";
import type { StagingStatus } from "@/types";

export async function GET(req: NextRequest) {
  const status = req.nextUrl.searchParams.get("status") as StagingStatus | null;
  const items = getAllStagingItems(status ?? undefined);
  return NextResponse.json(items);
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    if (Array.isArray(body)) {
      const batchId = body[0]?.batch_id || uuid();
      const created = body.map((item: { entity_type?: string; title: string; description?: string; parsed_data?: object }) =>
        createStagingItem({
          id: uuid(),
          entity_type: (item.entity_type as "item" | "client") || "item",
          title: item.title || "",
          description: item.description || "",
          parsed_data: JSON.stringify(item.parsed_data || {}),
          batch_id: batchId,
        })
      );
      return NextResponse.json(created, { status: 201 });
    }

    const item = createStagingItem({
      id: uuid(),
      entity_type: body.entity_type || "item",
      title: body.title || "",
      description: body.description || "",
      parsed_data: JSON.stringify(body.parsed_data || {}),
      batch_id: body.batch_id || uuid(),
    });
    return NextResponse.json(item, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
}
