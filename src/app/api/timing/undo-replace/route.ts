import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api-auth";
import { prepare } from "@/lib/sql";
import { undoMutexReplace } from "@/lib/timing-db";
import type { ActiveTimerSnapshot } from "@/types";

/**
 * Undo a recent mutex_replace (Toggl-style "Just kidding, restart the previous
 * timer"). Body: { current_active_id, replaced_entry_id }. The replaced entry
 * must have been closed within the last 60 seconds.
 */
export const POST = withAuth(async (req, _ctx, user) => {
  let body: { current_active_id?: unknown; replaced_entry_id?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const currentId = typeof body.current_active_id === "string" ? body.current_active_id : "";
  const replacedId = typeof body.replaced_entry_id === "string" ? body.replaced_entry_id : "";
  if (!currentId || !replacedId) {
    return NextResponse.json(
      { error: "current_active_id and replaced_entry_id are required" },
      { status: 400 },
    );
  }

  const { resurrected } = await undoMutexReplace({
    userEmail: user.email,
    currentActiveId: currentId,
    replacedEntryId: replacedId,
  });

  if (!resurrected) {
    return NextResponse.json(
      { error: "undo window expired or state mismatch" },
      { status: 409 },
    );
  }

  const item = await prepare<{ title: string }>(
    "SELECT title FROM items WHERE id = ?"
  ).get(resurrected.item_id);

  const snapshot: ActiveTimerSnapshot = {
    entry: resurrected,
    item_title: item?.title ?? null,
    server_now: new Date().toISOString(),
  };
  return NextResponse.json(snapshot);
});
