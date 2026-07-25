import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api-auth";
import { getAllItemSelfTotals } from "@/lib/timing-db";

/**
 * Bulk fetch self-time totals for *all* the user's items.
 * Returns: { [item_id]: seconds }
 */
export const GET = withAuth(async (_req, _ctx, user) => {
  const map = await getAllItemSelfTotals(user.email);
  const out: Record<string, number> = {};
  for (const [k, v] of map.entries()) out[k] = v;
  return NextResponse.json({ totals: out, server_now: new Date().toISOString() });
});
