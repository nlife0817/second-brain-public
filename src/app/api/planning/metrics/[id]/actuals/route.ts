import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/api-auth";
import { getMetric, getPeriod } from "@/lib/db";
import { prepare, transaction } from "@/lib/sql";
import { logChange } from "@/lib/planning-changelog";

// PATCH /api/planning/metrics/[id]/actuals
// items: [{ period_id, value }]
// Используется для ручного ввода факта (metric.source='manual', P4 концепта).
// Семантика: одна tick-запись на период, measured_at = period.end_date,
// source='manual'. При повторном save'е старые tick'и периода удаляются.
export const PATCH = withAuth(async (req: NextRequest, ctx, user) => {
  const { id } = await ctx.params;
  const metric = await getMetric(id);
  if (!metric) return NextResponse.json({ error: "metric not found" }, { status: 404 });

  const body = await req.json();
  const items: Array<{ period_id: string; value: number }> = Array.isArray(body?.items) ? body.items : [];
  if (items.length === 0) return NextResponse.json({ error: "items required" }, { status: 400 });

  const inserted: Array<{ period_id: string; value: number }> = [];
  await transaction(async (tx) => {
    for (const it of items) {
      const period = await getPeriod(it.period_id);
      if (!period) continue;
      // Заменяем существующие ticks в диапазоне периода на одну строку с measured_at = end_date.
      await tx.prepare(`
        DELETE FROM planning_metric_ticks
        WHERE metric_id = ? AND measured_at BETWEEN ? AND ?
      `).run(id, period.start_date, period.end_date);
      await tx.prepare(`
        INSERT INTO planning_metric_ticks (metric_id, value, measured_at, source)
        VALUES (?, ?, ?, 'manual')
      `).run(id, it.value, period.end_date);
      inserted.push({ period_id: it.period_id, value: it.value });
    }
  });

  await logChange({
    actor_email: user.email,
    entity_type: "metric",
    entity_id: id,
    action: "manual_actuals",
    diff: { count: { from: null, to: inserted.length } },
    context: { items: inserted },
  });

  // Возвращаем актуальные ticks для удобства клиента.
  const ticks = await prepare(`
    SELECT * FROM planning_metric_ticks WHERE metric_id = ? ORDER BY measured_at ASC
  `).all(id);
  return NextResponse.json(ticks);
});
