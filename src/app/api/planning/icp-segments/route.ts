import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/api-auth";
import { listIcpSegments, createIcpSegment } from "@/lib/db";

export const GET = withAuth(async (req: NextRequest) => {
  const includeArchived = req.nextUrl.searchParams.get("include_archived") === "1";
  return NextResponse.json(await listIcpSegments(includeArchived));
});

export const POST = withAuth(async (req: NextRequest) => {
  const body = await req.json().catch(() => null) as { title?: string } | null;
  if (!body?.title?.trim()) return NextResponse.json({ error: "title required" }, { status: 400 });
  const row = await createIcpSegment(body.title.trim());
  return NextResponse.json(row, { status: 201 });
});
