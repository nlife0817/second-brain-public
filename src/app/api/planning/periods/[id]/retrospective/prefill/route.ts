import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api-auth";
import { getPeriod, listChangeLog, listInitiatives } from "@/lib/db";

export const POST = withAuth(async (_req, ctx) => {
  const { id } = await ctx.params;
  const period = await getPeriod(id);
  if (!period) return NextResponse.json({ error: "not found" }, { status: 404 });

  const logs = await listChangeLog({ from: period.start_date, to: period.end_date }, 1000, 0);
  const killed = logs.filter((l) => l.entity_type === "initiative" && l.action === "update" && l.diff && (l.diff as Record<string, { from: unknown; to: unknown }>).status?.to === "killed");
  const killCriteria = logs.filter((l) => l.replan_reason && (l.replan_reason as { code?: string }).code === "kill_criteria_triggered");
  const minor = logs.filter((l) => l.replan_reason && (l.replan_reason as { code?: string }).code === "minor_adjustment");

  // Initiatives done in window
  const finishedInWindow = (await listInitiatives({ status: "done" })).filter(
    (i) => i.done_at && i.done_at >= period.start_date && i.done_at <= period.end_date
  );
  const missed = (await listInitiatives({ status: "planned" })).filter(
    (i) => i.due_period_id && i.due_period_id === period.id
  );

  const draft = {
    what_went_well: finishedInWindow.length
      ? `Закрыто ${finishedInWindow.length} инициатив в дедлайн: ${finishedInWindow.map((i) => i.title).join(", ")}.`
      : "",
    what_didnt: missed.length
      ? `Пропущено ${missed.length} дедлайнов: ${missed.map((i) => i.title).join(", ")}.`
      : "",
    what_to_try: "",
    lessons_learned: killed.length || killCriteria.length || minor.length
      ? [
          killed.length ? `Убитых инициатив: ${killed.length}.` : "",
          killCriteria.length ? `Сработавших kill_criteria: ${killCriteria.length}.` : "",
          minor.length ? `Минорных правок: ${minor.length}.` : "",
        ].filter(Boolean).join(" ")
      : "",
  };

  return NextResponse.json(draft);
});
