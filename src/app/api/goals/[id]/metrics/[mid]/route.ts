import { NextRequest, NextResponse } from "next/server";
import { updateMetric, deleteMetric, getMetricsForGoal } from "@/lib/db";
import { validateParentMetric } from "@/lib/goals-inheritance";
import type { UpdateMetricPayload } from "@/types";
import { getAuthUser } from "@/lib/auth";

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string; mid: string }> }) {
  const user = await getAuthUser();
  if (!user || user.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id, mid } = await ctx.params;
  try {
    const body: UpdateMetricPayload = await req.json();
    if (Object.prototype.hasOwnProperty.call(body, "parent_metric_id") && body.parent_metric_id) {
      // Resolve current kind to validate against (the parent must match it).
      const existing = (await getMetricsForGoal(id)).find((m) => m.id === mid);
      if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
      const err = await validateParentMetric(id, existing.kind, body.parent_metric_id);
      if (err) return NextResponse.json({ error: err }, { status: 400 });
    }
    const updated = await updateMetric(mid, body);
    if (!updated) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(updated);
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string; mid: string }> }) {
  const user = await getAuthUser();
  if (!user || user.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { mid } = await ctx.params;
  const ok = await deleteMetric(mid);
  if (!ok) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ success: true });
}
