import { NextRequest, NextResponse } from "next/server";
import { getRelationCountsBatch, getCommentCountsBatch, getRelationTitlesBatch } from "@/lib/db";
import type { EntityType } from "@/types";

export async function GET(req: NextRequest) {
  const entityType = req.nextUrl.searchParams.get("entity_type") as EntityType | null;
  if (!entityType) return NextResponse.json({ error: "entity_type required" }, { status: 400 });

  return NextResponse.json({
    relations: getRelationCountsBatch(entityType),
    comments: getCommentCountsBatch(entityType),
    relationTitles: getRelationTitlesBatch(entityType),
  });
}
