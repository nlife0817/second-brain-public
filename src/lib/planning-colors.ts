// Color tokens for planning system. See planning_system_concept.md §20.1.5.
//
// Semantic colors are fixed across the app (not themed):
//   on_track / done    — green
//   at_risk / inconclusive — amber
//   off_track / killed / invalidated — red
//   future / planned   — slate
//   in_progress        — blue
//   archived           — dark slate

import type { InitiativeStatus, ExperimentDecision, PlanningInitiative, PlanningPeriod } from "@/types/planning";

export type SemanticTone = "on_track" | "at_risk" | "off_track" | "future" | "in_progress" | "archived";

export const SEMANTIC_HEX: Record<SemanticTone, string> = {
  on_track: "#16a34a",
  at_risk: "#eab308",
  off_track: "#dc2626",
  future: "#9ca3af",
  in_progress: "#2563eb",
  archived: "#374151",
};

export const SEMANTIC_CLASS: Record<SemanticTone, { bg: string; text: string; border: string; dot: string }> = {
  on_track:    { bg: "bg-emerald-50",  text: "text-emerald-700", border: "border-emerald-300",  dot: "bg-emerald-500" },
  at_risk:     { bg: "bg-amber-50",    text: "text-amber-700",   border: "border-amber-300",    dot: "bg-amber-500" },
  off_track:   { bg: "bg-red-50",      text: "text-red-700",     border: "border-red-300",      dot: "bg-red-500" },
  future:      { bg: "bg-slate-50",    text: "text-slate-600",   border: "border-slate-300",    dot: "bg-slate-300" },
  in_progress: { bg: "bg-blue-50",     text: "text-blue-700",    border: "border-blue-300",     dot: "bg-blue-500" },
  archived:    { bg: "bg-slate-100",   text: "text-slate-700",   border: "border-slate-400",    dot: "bg-slate-600" },
};

export function initiativeStatusTone(status: InitiativeStatus): SemanticTone {
  switch (status) {
    case "done":        return "on_track";
    case "in_progress": return "in_progress";
    case "killed":      return "archived";
    case "planned":     return "future";
  }
}

export function experimentDecisionTone(d: ExperimentDecision | null): SemanticTone {
  switch (d) {
    case "validated":    return "on_track";
    case "invalidated":  return "off_track";
    case "inconclusive": return "at_risk";
    default:             return "future";
  }
}

export const INITIATIVE_STATUS_LABEL: Record<InitiativeStatus, string> = {
  planned: "Запланирована",
  in_progress: "В работе",
  done: "Сделана",
  killed: "Убита",
};

// Concept §20.1.5 + §4: подсветка раннего предупреждения.
// — done/killed/planned/in_progress наследуют базовый тон, НО:
//   • дедлайн прошёл и статус не done → off_track
//   • дедлайн в окне раннего предупреждения (early_warning_weeks) → at_risk
// P7.4: учитываем прогресс задач если он передан. Дедлайн в окне раннего
// предупреждения + tasks_done/total < 0.5 → at_risk даже если по дате ещё рано.
export function initiativeDeadlineTone(
  initiative: PlanningInitiative,
  periods: PlanningPeriod[],
  earlyWarningWeeks: number,
  now: Date = new Date(),
): SemanticTone {
  const base = initiativeStatusTone(initiative.status);
  if (initiative.status === "done" || initiative.status === "killed") return base;
  // Дедлайн — это end_period_id (start..end range, §P2). due_period_id остаётся
  // как legacy зеркало (sync_due_period trigger), используем как fallback.
  const deadlinePeriodId = initiative.end_period_id ?? initiative.due_period_id;
  if (!deadlinePeriodId) return base;
  const period = periods.find((p) => p.id === deadlinePeriodId);
  if (!period) return base;
  const endTs = new Date(period.end_date).getTime();
  const nowTs = now.getTime();
  if (endTs < nowTs) return "off_track";
  const weeksLeft = (endTs - nowTs) / (7 * 86400000);
  if (weeksLeft <= earlyWarningWeeks) return "at_risk";
  // Прогресс-aware: если задач очень мало сделано и инициатива уже в работе —
  // подсвечиваем заранее, не дожидаясь окна.
  if (initiative.status === "in_progress"
      && (initiative.tasks_total ?? 0) > 0
      && (initiative.tasks_done ?? 0) / (initiative.tasks_total ?? 1) < 0.3
      && weeksLeft <= earlyWarningWeeks * 2) {
    return "at_risk";
  }
  return base;
}

// P7.4: «дедлайн прошёл и задачи не выполнены» — отличаем «Failed» (явная
// неудача: нет прогресса или меньше 80%) от «Просрочена» (просто опоздание).
export function initiativeIsFailed(initiative: PlanningInitiative): boolean {
  if (initiative.status === "done" || initiative.status === "killed") return false;
  const total = initiative.tasks_total ?? 0;
  const done = initiative.tasks_done ?? 0;
  return total === 0 || done / total < 0.8;
}
