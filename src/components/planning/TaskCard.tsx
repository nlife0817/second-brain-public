"use client";

import { memo } from "react";
import { Clock, Repeat, Calendar } from "lucide-react";
import type { Item, ItemStatus } from "@/types";
import { InlineTextField } from "./InlineTextField";
import { usePlanningStore } from "@/lib/planning-store";

interface Props { task: Item; }

// Concept §20.2.1: «На карточке задачи — `why` (укороченное до 80 символов), статус».
// + category (development/sales/...) + carryover, чтобы видеть переносы и тип работы.

const STATUS_LABEL: Record<ItemStatus, string> = {
  inbox: "Inbox",
  todo: "В очереди",
  in_progress: "В работе",
  review: "Ревью",
  done: "Сделана",
  archived: "В архиве",
};

const STATUS_TONE: Record<ItemStatus, string> = {
  inbox: "bg-slate-100 text-slate-600",
  todo: "bg-slate-50 text-slate-500",
  in_progress: "bg-blue-50 text-blue-700",
  review: "bg-amber-50 text-amber-700",
  done: "bg-emerald-50 text-emerald-700",
  archived: "bg-slate-100 text-slate-500",
};

const CATEGORY_LABEL: Record<string, string> = {
  development: "Разработка",
  sales: "Sales",
  account: "Account",
  support: "Поддержка",
  legal: "Legal",
};

const CATEGORY_TONE: Record<string, string> = {
  development: "bg-blue-50 text-blue-700",
  sales: "bg-emerald-50 text-emerald-700",
  account: "bg-violet-50 text-violet-700",
  support: "bg-amber-50 text-amber-700",
  legal: "bg-slate-100 text-slate-600",
};

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

function TaskCardBase({ task }: Props) {
  const updateTask = usePlanningStore((s) => s.updateTask);
  const isDone = task.status === "done";
  const statusTone = STATUS_TONE[task.status];
  const statusLabel = STATUS_LABEL[task.status];
  const cat = task.category;
  const catLabel = CATEGORY_LABEL[cat] ?? cat;
  const catTone = CATEGORY_TONE[cat] ?? "bg-slate-100 text-slate-600";
  const estHours = task.estimated_minutes != null ? (task.estimated_minutes / 60).toFixed(1).replace(".0", "") : null;

  return (
    <div className={`rounded-lg border p-3 transition-colors ${isDone ? "border-slate-100 bg-slate-50/50" : "border-slate-200 hover:bg-slate-50"}`}>
      <div className="flex items-start gap-2">
        <input
          type="checkbox"
          checked={isDone}
          onChange={(e) => updateTask(task.id, { status: e.target.checked ? "done" : "todo" })}
          className="mt-1 size-3.5 cursor-pointer rounded border-slate-300"
          title={isDone ? "Снять отметку «сделано»" : "Отметить как сделано"}
        />
        <div className="min-w-0 flex-1">
          <InlineTextField
            value={task.title}
            onSave={(t) => updateTask(task.id, { title: t })}
            className={`text-sm ${isDone ? "text-slate-400 line-through" : "font-medium"}`}
          />
          {task.why ? (
            <p className="px-2 text-xs italic text-slate-500" title={task.why ?? undefined}>
              {truncate(task.why, 80)}
            </p>
          ) : null}

          {/* Meta row: status, category, estimate, carryover, planned-date */}
          <div className="flex flex-wrap items-center gap-1 px-2 pt-1.5">
            <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-medium ${statusTone}`}>
              {statusLabel}
            </span>
            {cat && (
              <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-medium ${catTone}`} title="Категория">
                {catLabel}
              </span>
            )}
            {estHours && (
              <span className="inline-flex items-center gap-0.5 rounded-md bg-slate-50 px-1.5 py-0.5 text-[10px] text-slate-500" title="Оценка часов">
                <Clock className="size-3" />
                {estHours}ч
              </span>
            )}
            {task.planned_date && (
              <span className="inline-flex items-center gap-0.5 rounded-md bg-slate-50 px-1.5 py-0.5 text-[10px] text-slate-500" title="Запланирована на день">
                <Calendar className="size-3" />
                {task.planned_date.slice(5, 10)}
              </span>
            )}
            {task.is_carryover && (
              <span className="inline-flex items-center gap-0.5 rounded-md bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700" title="Перенесена с прошлого периода">
                <Repeat className="size-3" />
                перенос
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export const TaskCard = memo(TaskCardBase);
