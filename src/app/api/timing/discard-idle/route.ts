import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api-auth";
import { prepare } from "@/lib/sql";
import { discardIdle } from "@/lib/timing-db";
import type { ActiveTimerSnapshot } from "@/types";

export const POST = withAuth(async (req, _ctx, user) => {
  let body: { cut_at?: unknown; restart?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (typeof body.cut_at !== "string") {
    return NextResponse.json({ error: "cut_at (ISO string) is required" }, { status: 400 });
  }
  const cutAt = new Date(body.cut_at);
  if (isNaN(cutAt.getTime())) {
    return NextResponse.json({ error: "cut_at is not a valid date" }, { status: 400 });
  }
  const restart = body.restart === true;

  const result = await discardIdle({
    userEmail: user.email,
    cutAt,
    restart,
  });

  // Build a snapshot reflecting the new state for the client.
  const newActive = result.new ?? null;
  let itemTitle: string | null = null;
  if (newActive) {
    const row = await prepare<{ title: string }>(
      "SELECT title FROM items WHERE id = ?"
    ).get(newActive.item_id);
    itemTitle = row?.title ?? null;
  }

  const snapshot: ActiveTimerSnapshot = {
    entry: newActive,
    item_title: itemTitle,
    server_now: new Date().toISOString(),
  };

  return NextResponse.json({
    closed: result.closed ?? null,
    snapshot,
  });
});
