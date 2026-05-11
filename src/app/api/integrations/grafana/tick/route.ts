import { NextRequest, NextResponse } from "next/server";
import { addMetricTick, getMetric } from "@/lib/db";

/**
 * Grafana webhook → planning_metric_ticks.
 * Body: { metric_id, value, measured_at?, source? }
 * Auth: Bearer ${GRAFANA_WEBHOOK_SECRET}.
 */
export async function POST(req: NextRequest) {
  const auth = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${process.env.GRAFANA_WEBHOOK_SECRET ?? ""}`;
  if (!process.env.GRAFANA_WEBHOOK_SECRET || auth !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await req.json();
  if (!body?.metric_id || typeof body?.value !== "number") {
    return NextResponse.json({ error: "metric_id and value required" }, { status: 400 });
  }
  const metric = await getMetric(body.metric_id);
  if (!metric) return NextResponse.json({ error: "metric not found" }, { status: 404 });
  const row = await addMetricTick({
    metric_id: body.metric_id,
    value: Number(body.value),
    measured_at: body.measured_at ?? new Date().toISOString(),
    source: body.source ?? "grafana",
  });
  return NextResponse.json(row, { status: 201 });
}
