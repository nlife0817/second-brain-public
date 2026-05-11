"use client";

import { memo } from "react";
import type { PlanningInitiative } from "@/types/planning";
import { InlineTextField } from "./InlineTextField";
import { usePlanningStore } from "@/lib/planning-store";
import { initiativeStatusTone, SEMANTIC_CLASS } from "@/lib/planning-colors";

interface Props { initiative: PlanningInitiative; selected: boolean; onSelect: () => void; }

const TYPE_LABEL: Record<PlanningInitiative["type"], string> = {
  client_blocker: "Блокер",
  product_maturity: "Зрелость",
  tech_debt: "Тех. долг",
  experiment: "Эксп.",
  support: "Поддержка",
};

function InitiativeCardBase({ initiative, selected, onSelect }: Props) {
  const updateInitiative = usePlanningStore((s) => s.updateInitiative);
  const openDetail = usePlanningStore((s) => s.openInitiativeDetail);
  const tone = initiativeStatusTone(initiative.status);
  const dot = SEMANTIC_CLASS[tone].dot;

  return (
    <div
      onClick={() => { onSelect(); openDetail(initiative.id); }}
      className={`cursor-pointer rounded-lg border p-3 transition-colors ${
        selected ? "border-blue-500 bg-blue-50" : "border-slate-200 hover:bg-slate-50"
      }`}
    >
      <div className="flex items-center gap-2">
        <span className={`size-2 shrink-0 rounded-full ${dot}`} title={initiative.status} />
        <div className="flex-1" onClick={(e) => e.stopPropagation()}>
          <InlineTextField
            value={initiative.title}
            onSave={(t) => updateInitiative(initiative.id, { title: t })}
            className="text-sm font-medium"
          />
        </div>
        {initiative.rice_score > 0 && (
          <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-slate-700" title="RICE Score">
            {Number(initiative.rice_score).toFixed(1)}
          </span>
        )}
      </div>
      <p className="px-2 text-xs text-slate-500">{TYPE_LABEL[initiative.type]}</p>
    </div>
  );
}

export const InitiativeCard = memo(InitiativeCardBase);
