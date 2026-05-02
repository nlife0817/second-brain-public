import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api-auth";
import { updateEntry, deleteEntry } from "@/lib/timing-db";

export const PUT = withAuth(async (req, ctx, user) => {
  const { id } = await ctx.params;
  let body: {
    started_at?: unknown;
    ended_at?: unknown;
    note?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  let started: Date | undefined;
  let ended: Date | undefined;
  if (body.started_at != null) {
    if (typeof body.started_at !== "string") {
      return NextResponse.json({ error: "started_at must be ISO string" }, { status: 400 });
    }
    started = new Date(body.started_at);
    if (isNaN(started.getTime())) {
      return NextResponse.json({ error: "started_at invalid" }, { status: 400 });
    }
  }
  if (body.ended_at != null) {
    if (typeof body.ended_at !== "string") {
      return NextResponse.json({ error: "ended_at must be ISO string" }, { status: 400 });
    }
    ended = new Date(body.ended_at);
    if (isNaN(ended.getTime())) {
      return NextResponse.json({ error: "ended_at invalid" }, { status: 400 });
    }
  }
  const note = typeof body.note === "string" ? body.note : undefined;

  try {
    const updated = await updateEntry({
      id,
      userEmail: user.email,
      startedAt: started,
      endedAt: ended,
      note,
    });
    if (!updated) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json(updated);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "update failed" },
      { status: 400 },
    );
  }
});

export const DELETE = withAuth(async (_req, ctx, user) => {
  const { id } = await ctx.params;
  const ok = await deleteEntry(id, user.email);
  if (!ok) return NextResponse.json({ error: "not found or active" }, { status: 404 });
  return NextResponse.json({ ok: true });
});
