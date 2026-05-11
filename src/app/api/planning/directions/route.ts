import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/api-auth";
import { listDirections, createDirection } from "@/lib/db";
import { logChange } from "@/lib/planning-changelog";

export const GET = withAuth(async () => {
  const rows = await listDirections();
  return NextResponse.json(rows);
});

export const POST = withAuth(async (req: NextRequest, _ctx, user) => {
  const body = await req.json();
  if (!body?.title || typeof body.title !== "string") {
    return NextResponse.json({ error: "title is required" }, { status: 400 });
  }
  const row = await createDirection({
    title: body.title,
    year_focus: body.year_focus ?? null,
    position: typeof body.position === "number" ? body.position : 0,
  });
  await logChange({
    actor_email: user.email,
    entity_type: "direction",
    entity_id: row.id,
    action: "create",
    diff: { title: { from: null, to: row.title } },
  });
  return NextResponse.json(row, { status: 201 });
});
