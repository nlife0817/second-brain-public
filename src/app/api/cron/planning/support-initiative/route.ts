import { NextRequest, NextResponse } from "next/server";
import { listDirections, findOrCreateSupportInitiative } from "@/lib/db";
import { logChange } from "@/lib/planning-changelog";

/**
 * Cron: ensures every direction (and a global one) has a "Поддержка Qx YYYY"
 * initiative for the current quarter. Idempotent — skips if exists.
 *
 * See planning_system_concept.md §6.3.
 * Auth: Bearer ${CRON_SECRET}.
 */
export async function POST(req: NextRequest) {
  const auth = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${process.env.CRON_SECRET ?? ""}`;
  if (!process.env.CRON_SECRET || auth !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const directions = await listDirections();
  // Always include a NULL-direction bucket (for direction-less work).
  const targets: Array<string | null> = [null, ...directions.map((d) => d.id)];

  let created = 0;
  const results: Array<{ direction_id: string | null; initiative_id: string | null; created: boolean }> = [];
  for (const did of targets) {
    const before = await findOrCreateSupportInitiative(did);
    if (!before) {
      results.push({ direction_id: did, initiative_id: null, created: false });
      continue;
    }
    // Detect whether we actually created: rough check — done_at null, created in last 30s.
    const justCreated = Date.now() - new Date(before.created_at).getTime() < 30_000;
    if (justCreated) {
      created += 1;
      await logChange({
        actor_email: "system",
        entity_type: "initiative",
        entity_id: before.id,
        action: "create",
        diff: { title: { from: null, to: before.title }, type: { from: null, to: "support" } },
        context: { source: "cron/support-initiative" },
      });
    }
    results.push({ direction_id: did, initiative_id: before.id, created: justCreated });
  }

  return NextResponse.json({ targets: targets.length, created, results });
}
