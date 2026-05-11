import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/api-auth";
import { listEffectiveMetricTicks, addMetricTick, getMetric } from "@/lib/db";

// GET /api/planning/metrics/[id]/ticks
// P5+P8: для business-метрики с source='second_brain' возвращает синтезированные
// ticks из client_deal_payments. Для остальных — реальные строки из
// planning_metric_ticks.
export const GET = withAuth(async (req: NextRequest, ctx) => {
  const { id } = await ctx.params;
  const url = new URL(req.url);
  const from = url.searchParams.get("from") ?? undefined;
  const to = url.searchParams.get("to") ?? undefined;
  const limit = url.searchParams.get("limit");
  const metric = await getMetric(id);
  if (!metric) return NextResponse.json([]);
  const rows = await listEffectiveMetricTicks(metric, {
    from, to, limit: limit ? Number(limit) : undefined,
  });
  return NextResponse.json(rows);
});

export const POST = withAuth(async (req: NextRequest, ctx) => {
  const { id } = await ctx.params;
  const body = await req.json();
  if (typeof body?.value !== "number" || !body?.measured_at) {
    return NextResponse.json({ error: "value and measured_at required" }, { status: 400 });
  }
  const row = await addMetricTick({
    metric_id: id,
    value: Number(body.value),
    measured_at: body.measured_at,
    source: body.source ?? null,
  });
  return NextResponse.json(row, { status: 201 });
});
