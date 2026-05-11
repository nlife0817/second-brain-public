"use client";

import { memo } from "react";
import { CalendarClock, AlertTriangle, Maximize2 } from "lucide-react";
import type { PlanningInitiative } from "@/types/planning";
import { usePlanningStore } from "@/lib/planning-store";
import { initiativeDeadlineTone, initiativeIsFailed, SEMANTIC_CLASS, INITIATIVE_STATUS_LABEL } from "@/lib/planning-colors";
import { formatPeriodShort } from "@/lib/planning-format";

interface Props { initiative: PlanningInitiative; selected: boolean; onSelect: () => void; }

const TYPE_LABEL: Record<PlanningInitiative["type"], string> = {
  client_blocker: "Блокер",
  product_maturity: "Развитие",
  tech_debt: "Тех. долг",
  experiment: "Эксп.",
  support: "Поддержка",
};

const TYPE_TONE: Record<PlanningInitiative["type"], string> = {
  client_blocker: "bg-red-50 text-red-700",
  product_maturity: "bg-emerald-50 text-emerald-700",
  tech_debt: "bg-slate-100 text-slate-600",
  experiment: "bg-violet-50 text-violet-700",
  support: "bg-amber-50 text-amber-700",
};

function InitiativeCardBase({ initiative, selected, onSelect }: Props) {
  const openDetail = usePlanningStore((s) => s.openInitiativeDetail);
  const periods = usePlanningStore((s) => s.periods);
  const settings = usePlanningStore((s) => s.settings);

  const earlyWarningWeeks = settings?.early_warning_weeks ?? 4;
  const tone = initiativeDeadlineTone(initiative, periods, earlyWarningWeeks);
  const toneCls = SEMANTIC_CLASS[tone];

  // Дедлайн — последняя неделя диапазона (end_period_id). Сохраняем fallback
  // на due_period_id для совместимости (триггер sync_due_period держит их равными).
  const period = periods.find((p) => p.id === (initiative.end_period_id ?? initiative.due_period_id));
  const dueLabel = period ? formatPeriodShort(period) : null;
  const isAtRisk = tone === "at_risk";
  const isOffTrack = tone === "off_track";
  // Явный badge «Просрочена» (PLAN_PLANNING_REWORK §P2): only when deadline
  // прошёл и инициатива ещё не закрыта/убита.
  const isOverdue = isOffTrack && initiative.status !== "done" && initiative.status !== "killed";
  // P7.4: «Failed» — overdue + плохой прогресс задач. Показывается вместо
  // «Просрочена», когда задач почти нет сделанных.
  const isFailed = isOverdue && initiativeIsFailed(initiative);
  const total = initiative.tasks_total ?? 0;
  const done = initiative.tasks_done ?? 0;

  return (
    <div
      onClick={onSelect}
      className={`group cursor-pointer rounded-lg border p-3 transition-colors ${
        selected
          ? "border-blue-500 bg-blue-50"
          : isOverdue
            ? "border-red-300 bg-red-50/60 hover:bg-red-100/50"
            : `border-slate-200 hover:bg-slate-50 ${isOffTrack ? "border-l-2 border-l-red-500" : isAtRisk ? "border-l-2 border-l-amber-500" : ""}`
      }`}
      title={INITIATIVE_STATUS_LABEL[initiative.status]}
    >
      {/* Row 1: status-dot + title + RICE + open */}
      <div className="flex items-center gap-2">
        <span
          className={`size-2 shrink-0 rounded-full ${toneCls.dot} ${isAtRisk ? "animate-pulse" : ""}`}
          title={INITIATIVE_STATUS_LABEL[initiative.status]}
        />
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-900">
          {initiative.title}
        </span>
        {initiative.rice_score > 0 && (
          <span
            className="shrink-0 rounded-md bg-slate-100 px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-slate-700"
            title={`RICE: ${initiative.rice_score}`}
          >
            {Number(initiative.rice_score).toFixed(1)}
          </span>
        )}
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); openDetail(initiative.id); }}
          className="shrink-0 rounded-md p-1 text-slate-400 opacity-0 transition-opacity hover:bg-white hover:text-blue-600 group-hover:opacity-100"
          title="Открыть инициативу"
        >
          <Maximize2 className="size-3.5" />
        </button>
      </div>

      {/* Row 2: type-badge + deadline + status-text (progressive disclosure §20.1.3) */}
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5 px-2">
        <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-medium ${TYPE_TONE[initiative.type]}`}>
          {TYPE_LABEL[initiative.type]}
        </span>
        {dueLabel && (
          <span
            className={`inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[10px] font-medium ${
              isOffTrack
                ? "bg-red-50 text-red-700"
                : isAtRisk
                  ? "bg-amber-50 text-amber-700"
                  : "bg-slate-50 text-slate-600"
            }`}
            title={`Дедлайн: ${period?.end_date.slice(0, 10) ?? ""}`}
          >
            {isOffTrack || isAtRisk ? <AlertTriangle className="size-3" /> : <CalendarClock className="size-3" />}
            {dueLabel}
          </span>
        )}
        {isOverdue && (
          <span
            className={`inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white ${
              isFailed ? "bg-red-700" : "bg-red-600"
            }`}
            title={
              isFailed
                ? `Failed: дедлайн ${period?.end_date.slice(0, 10) ?? ""} прошёл, ${done}/${total} задач сделано`
                : `Дедлайн прошёл: ${period?.end_date.slice(0, 10) ?? ""}`
            }
          >
            <AlertTriangle className="size-3" />
            {isFailed ? "Failed" : "Просрочена"}
          </span>
        )}
        {/* P7.4: показываем прогресс задач для at_risk/off_track инициатив */}
        {(isAtRisk || isOffTrack) && total > 0 && (
          <span
            className="rounded-md bg-slate-50 px-1.5 py-0.5 text-[10px] font-medium text-slate-600 tabular-nums"
            title="Прогресс связанных задач"
          >
            {done}/{total}
          </span>
        )}
        {initiative.parent_initiative_id && (
          <span
            className="rounded-md bg-violet-50 px-1.5 py-0.5 text-[10px] font-medium text-violet-700"
            title="Продолжение другой инициативы (B')"
          >
            B′
          </span>
        )}
      </div>
    </div>
  );
}

export const InitiativeCard = memo(InitiativeCardBase);
