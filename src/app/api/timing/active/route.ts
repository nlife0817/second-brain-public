import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api-auth";
import { prepare } from "@/lib/sql";
import { getActiveEntry } from "@/lib/timing-db";
import type { ActiveTimerSnapshot } from "@/types";

export const GET = withAuth(async (_req, _ctx, user) => {
  const entry = await getActiveEntry(user.email);
  let itemTitle: string | null = null;
  if (entry) {
    const row = await prepare<{ title: string }>(
      "SELECT title FROM items WHERE id = ?"
    ).get(entry.item_id);
    itemTitle = row?.title ?? null;
  }

  const snapshot: ActiveTimerSnapshot = {
    entry: entry ?? null,
    item_title: itemTitle,
    server_now: new Date().toISOString(),
  };

  return NextResponse.json(snapshot);
});
