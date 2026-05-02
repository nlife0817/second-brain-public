/**
 * Combined boot payload for timing UI: active timer (with item title),
 * per-user settings, and bulk { item_id => seconds } totals.
 *
 * Used by timing-store.hydrate() — replaces 3 separate fetches with one
 * round-trip. Uses Promise.all so the server runs the queries in parallel.
 */
import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api-auth";
import { prepare } from "@/lib/sql";
import {
  getActiveEntry,
  getAllItemSelfTotals,
  getTimingSettings,
} from "@/lib/timing-db";
import type { ActiveTimerSnapshot, TimeEntry, TimingSettings } from "@/types";

interface InitResponse {
  snapshot: ActiveTimerSnapshot;
  settings: TimingSettings;
  totals: Record<string, number>;
}

export const GET = withAuth(async (_req, _ctx, user) => {
  // Fetch active entry first because we need its item_id to JOIN the title.
  // Run settings + totals in parallel with the active lookup.
  const [active, settings, totalsMap] = await Promise.all([
    getActiveEntry(user.email),
    getTimingSettings(user.email),
    getAllItemSelfTotals(user.email),
  ]);

  let itemTitle: string | null = null;
  if (active) {
    const row = await prepare<{ title: string }>(
      "SELECT title FROM items WHERE id = ?",
    ).get(active.item_id);
    itemTitle = row?.title ?? null;
  }

  const snapshot: ActiveTimerSnapshot = {
    entry: (active ?? null) as TimeEntry | null,
    item_title: itemTitle,
    server_now: new Date().toISOString(),
  };

  const totals: Record<string, number> = {};
  for (const [k, v] of totalsMap.entries()) totals[k] = v;

  const payload: InitResponse = { snapshot, settings, totals };
  return NextResponse.json(payload);
});
