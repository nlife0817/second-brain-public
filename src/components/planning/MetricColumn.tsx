"use client";

import { useState } from "react";
import { Plus, ChevronsLeft, X } from "lucide-react";
import { usePlanningStore } from "@/lib/planning-store";
import { MetricCard } from "./MetricCard";
import { CollapsedColumn } from "./CollapsedColumn";
import type { MetricType } from "@/types/planning";

// Concept §3.3 — three metric types with semantic descriptions.
// Hints are shown in the inline creation form (and in MetricDetailSheet header).
const METRIC_TYPES: Array<{ value: MetricType; label: string; hint: string }> = [
  {
    value: "numeric",
    label: "Числовая",
    hint: "Технические метрики: latency, throughput, NPS, конверсия. Tick из источника, цели по горизонтам.",
  },
  {
    value: "business",
    label: "Бизнес",
    hint: "Деньги и подписания: выручка, новые клиенты. Факт автоматически из сделок/платежей, накопительная.",
  },
  {
    value: "delivery",
    label: "Выполнение",
    hint: "Именованный список инициатив с дедлайном. Прогресс по матрице «инициатива × попала в дедлайн».",
  },
];

export function MetricColumn() {
  const directionId = usePlanningStore((s) => s.selectedDirectionId);
  const metrics = usePlanningStore((s) => s.metrics).filter((m) => !directionId || m.direction_id === directionId);
  const selectedMetricId = usePlanningStore((s) => s.selectedMetricId);
  const setSelectedMetric = usePlanningStore((s) => s.setSelectedMetric);
  const openMetricDetail = usePlanningStore((s) => s.openMetricDetail);
  const createMetric = usePlanningStore((s) => s.createMetric);
  const sparklines = usePlanningStore((s) => s.metricSparklines);
  const latest = usePlanningStore((s) => s.metricLatest);
  const ytdMap = usePlanningStore((s) => s.metricYtd);
  const collapsed = usePlanningStore((s) => s.collapsedColumns.includes("metrics"));
  const toggleCollapse = usePlanningStore((s) => s.toggleColumnCollapsed);

  // Inline creation state — per user feedback: no modal for the simplest case.
  const [creating, setCreating] = useState(false);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftType, setDraftType] = useState<MetricType>("numeric");
  const [busy, setBusy] = useState(false);

  if (collapsed) {
    return <CollapsedColumn title="Метрики" count={metrics.length} onExpand={() => toggleCollapse("metrics")} />;
  }

  const submitInline = async () => {
    if (busy || !draftTitle.trim()) return;
    setBusy(true);
    // createMetric in the store sets detailMetricId = new metric + autoOpenSettings = true.
    // The MetricDetailSheet picks that up and opens with the settings tab expanded —
    // satisfies user feedback #10 (critical fields should not be hidden after create).
    await createMetric({ title: draftTitle.trim(), type: draftType });
    setBusy(false);
    setCreating(false);
    setDraftTitle("");
    setDraftType("numeric");
  };

  const cancelInline = () => {
    setCreating(false);
    setDraftTitle("");
    setDraftType("numeric");
  };

  return (
    <div className="flex h-full w-[320px] shrink-0 flex-col border-r border-slate-200">
      <div className="flex h-10 items-center justify-between border-b border-slate-200 px-3">
        <div className="flex items-center gap-1.5">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Метрики</h3>
          <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] tabular-nums text-slate-500">{metrics.length}</span>
        </div>
        <div className="flex items-center gap-0.5">
          <button
            onClick={() => setCreating(true)}
            disabled={!directionId || creating}
            className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-30"
            title={directionId ? "Добавить метрику" : "Сначала выберите направление"}
          >
            <Plus className="size-4" />
          </button>
          <button
            onClick={() => toggleCollapse("metrics")}
            className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            title="Свернуть колонку"
          >
            <ChevronsLeft className="size-4" />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {/* Inline creation form — shown at the top of the list */}
        {creating && (
          <div className="mb-2 rounded-lg border border-blue-300 bg-blue-50/50 p-3">
            <div className="flex items-start justify-between gap-2">
              <p className="text-xs font-medium text-slate-700">Новая метрика</p>
              <button
                onClick={cancelInline}
                className="rounded-md p-0.5 text-slate-400 hover:bg-white"
                title="Отмена"
              >
                <X className="size-3.5" />
              </button>
            </div>
            <input
              autoFocus
              value={draftTitle}
              onChange={(e) => setDraftTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submitInline();
                if (e.key === "Escape") cancelInline();
              }}
              placeholder="Название метрики (Enter — создать)"
              className="mt-1.5 w-full rounded-md border border-slate-300 bg-white px-2 py-1 text-sm"
              disabled={busy}
            />
            <div className="mt-2 flex flex-col gap-1">
              {METRIC_TYPES.map((t) => (
                <button
                  key={t.value}
                  onClick={() => setDraftType(t.value)}
                  className={`rounded-md border px-2 py-1.5 text-left text-xs transition-colors ${
                    draftType === t.value
                      ? "border-blue-500 bg-white text-blue-700"
                      : "border-slate-200 bg-white/60 text-slate-700 hover:bg-white"
                  }`}
                  disabled={busy}
                >
                  <div className="font-medium">{t.label}</div>
                  <div className="mt-0.5 text-[10px] text-slate-500 leading-snug">{t.hint}</div>
                </button>
              ))}
            </div>
            <div className="mt-2 flex justify-end gap-1">
              <button
                onClick={cancelInline}
                disabled={busy}
                className="rounded-md px-2 py-1 text-xs text-slate-600 hover:bg-white"
              >
                Отмена
              </button>
              <button
                onClick={submitInline}
                disabled={busy || !draftTitle.trim()}
                className="rounded-md bg-blue-600 px-2 py-1 text-xs text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {busy ? "Создаём…" : "Создать"}
              </button>
            </div>
          </div>
        )}

        {!creating && metrics.length === 0 ? (
          <div className="mt-8 text-center text-sm text-slate-500">
            <p>Метрик ещё нет.</p>
            <button
              onClick={() => setCreating(true)}
              disabled={!directionId}
              className="mt-3 rounded-md bg-blue-600 px-3 py-1.5 text-xs text-white hover:bg-blue-700 disabled:opacity-50"
            >
              Создать метрику
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {metrics.map((m) => (
              <MetricCard
                key={m.id}
                metric={m}
                selected={m.id === selectedMetricId}
                onSelect={() => setSelectedMetric(m.id)}
                onOpenDetail={() => openMetricDetail(m.id)}
                sparkline={sparklines[m.id]}
                latestValue={latest[m.id] ?? null}
                ytd={ytdMap[m.id]}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
