import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api-auth";
import { listEntries, insertManualEntry, getItemTimeTotals } from "@/lib/timing-db";

export const GET = withAuth(async (req, _ctx, user) => {
  const u = req.nextUrl.searchParams;
  const itemId = u.get("item_id") ?? undefined;
  const fromStr = u.get("from");
  const toStr = u.get("to");
  const limitStr = u.get("limit");

  const from = fromStr ? new Date(fromStr) : undefined;
  const to = toStr ? new Date(toStr) : undefined;
  if ((from && isNaN(from.getTime())) || (to && isNaN(to.getTime()))) {
    return NextResponse.json({ error: "from/to must be ISO timestamps" }, { status: 400 });
  }

  const entries = await listEntries({
    userEmail: user.email,
    itemId,
    from,
    to,
    limit: limitStr ? Number.parseInt(limitStr, 10) : undefined,
  });

  // If filtered to a single item, also send aggregated totals (self/total).
  let totals = null;
  if (itemId) totals = await getItemTimeTotals(user.email, itemId);

  return NextResponse.json({ entries, totals });
});

export const POST = withAuth(async (req, _ctx, user) => {
  let body: {
    item_id?: unknown;
    started_at?: unknown;
    ended_at?: unknown;
    note?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (typeof body.item_id !== "string" || !body.item_id.trim()) {
    return NextResponse.json({ error: "item_id required" }, { status: 400 });
  }
  if (typeof body.started_at !== "string" || typeof body.ended_at !== "string") {
    return NextResponse.json({ error: "started_at/ended_at required" }, { status: 400 });
  }
  const started = new Date(body.started_at);
  const ended = new Date(body.ended_at);
  if (isNaN(started.getTime()) || isNaN(ended.getTime())) {
    return NextResponse.json({ error: "started_at/ended_at must be ISO" }, { status: 400 });
  }
  if (ended <= started) {
    return NextResponse.json({ error: "ended_at must be after started_at" }, { status: 400 });
  }

  try {
    const entry = await insertManualEntry({
      userEmail: user.email,
      itemId: body.item_id.trim(),
      startedAt: started,
      endedAt: ended,
      note: typeof body.note === "string" ? body.note : undefined,
    });
    return NextResponse.json(entry, { status: 201 });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "insert failed" },
      { status: 400 },
    );
  }
});
