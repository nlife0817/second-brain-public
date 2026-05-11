"use client";

import { memo } from "react";
import { CalendarClock, AlertTriangle } from "lucide-react";
import type { PlanningInitiative } from "@/types/planning";
import { InlineTextField } from "./InlineTextField";
import { usePlanningStore } from "@/lib/planning-store";
import { initiativeDeadlineTone, SEMANTIC_CLASS, INITIATIVE_STATUS_LABEL } from "@/lib/planning-colors";
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
  const updateInitiative = usePlanningStore((s) => s.updateInitiative);
  const openDetail = usePlanningStore((s) => s.openInitiativeDetail);
  const periods = usePlanningStore((s) => s.periods);
  const settings = usePlanningStore((s) => s.settings);

  const earlyWarningWeeks = settings?.early_warning_weeks ?? 4;
  const tone = initiativeDeadlineTone(initiative, periods, earlyWarningWeeks);
  const toneCls = SEMANTIC_CLASS[tone];

  const period = periods.find((p) => p.id === initiative.due_period_id);
  const dueLabel = period ? formatPeriodShort(period) : null;
  const isAtRisk = tone === "at_risk";
  const isOffTrack = tone === "off_track";

  return (
    <div
      onClick={() => { onSelect(); openDetail(initiative.id); }}
      className={`group cursor-pointer rounded-lg border p-3 transition-colors ${
        selected
          ? "border-blue-500 bg-blue-50"
          : `border-slate-200 hover:bg-slate-50 ${isOffTrack ? "border-l-2 border-l-red-500" : isAtRisk ? "border-l-2 border-l-amber-500" : ""}`
      }`}
      title={INITIATIVE_STATUS_LABEL[initiative.status]}
    >
      {/* Row 1: status-dot + title + RICE */}
      <div className="flex items-center gap-2">
        <span
          className={`size-2 shrink-0 rounded-full ${toneCls.dot} ${isAtRisk ? "animate-pulse" : ""}`}
          title={INITIATIVE_STATUS_LABEL[initiative.status]}
        />
        <div className="min-w-0 flex-1" onClick={(e) => e.stopPropagation()}>
          <InlineTextField
            value={initiative.title}
            onSave={(t) => updateInitiative(initiative.id, { title: t })}
            className="text-sm font-medium"
          />
        </div>
        {initiative.rice_score > 0 && (
          <span
            className="shrink-0 rounded-md bg-slate-100 px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-slate-700"
            title={`RICE: ${initiative.rice_score}`}
          >
            {Number(initiative.rice_score).toFixed(1)}
          </span>
        )}
      </div>

      {/* Row 2: type-badge + deadline + status-text (progressive disclosure §20.1.3) */}
      <div className="mt-1.5 flex items-center gap-1.5 px-2">
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
