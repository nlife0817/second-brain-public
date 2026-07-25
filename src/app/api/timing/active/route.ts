import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api-auth";
import { prepare } from "@/lib/sql";
import type { ActiveTimerSnapshot, TimeEntry } from "@/types";

/**
 * Single-query active-timer lookup with item title via LEFT JOIN.
 * Replaces two sequential SELECTs (entry + title) with one round-trip.
 *
 * Note: clients now use /api/timing/init for the combined boot payload;
 * this endpoint stays for ad-hoc lookups and external integrations.
 */
type ActiveRow = TimeEntry & { item_title: string | null };

export const GET = withAuth(async (_req, _ctx, user) => {
  const row = await prepare<ActiveRow>(`
    SELECT te.*, i.title AS item_title
    FROM time_entries te
    LEFT JOIN items i ON i.id = te.item_id
    WHERE te.user_email = ? AND te.ended_at IS NULL
    LIMIT 1
  `).get(user.email);

  let entry: TimeEntry | null = null;
  let itemTitle: string | null = null;
  if (row) {
    const { item_title, ...rest } = row;
    entry = rest;
    itemTitle = item_title;
  }

  const snapshot: ActiveTimerSnapshot = {
    entry,
    item_title: itemTitle,
    server_now: new Date().toISOString(),
  };
  return NextResponse.json(snapshot);
});
