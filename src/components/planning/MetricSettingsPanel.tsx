"use client";

import { useState } from "react";
import { toast } from "sonner";
import { markLocalMutation } from "@/lib/planning-realtime";
import { usePlanningStore } from "@/lib/planning-store";
import type { PlanningMetric, MetricDirection, MetricSource } from "@/types/planning";

interface Props {
  metric: PlanningMetric;
  onChanged: () => void;
}

const DIRECTION_OPTIONS: Array<{ value: MetricDirection; label: string }> = [
  { value: "up",   label: "Вверх (рост = хорошо)" },
  { value: "down", label: "Вниз (снижение = хорошо)" },
];

// Kaiten как источник факта снят (см. PLAN_PLANNING_REWORK §0 / миграция 0029).
const SOURCE_OPTIONS: Array<{ value: MetricSource; label: string }> = [
  { value: "manual",            label: "Ручной ввод" },
  { value: "grafana",           label: "Grafana" },
  { value: "second_brain",      label: "Second Brain (сделки/задачи)" },
  { value: "product_analytics", label: "Product Analytics" },
];

// Per concept §3.11 «Единицы измерения метрик».
// Grouped by domain so the picker scans faster.
const UNIT_GROUPS: Array<{ label: string; units: string[] }> = [
  { label: "Деньги",   units: ["₽", "$", "€"] },
  { label: "Скорость", units: ["ms", "sec", "rps"] },
  { label: "Память",   units: ["GB", "MB", "KB"] },
  { label: "Прочее",   units: ["шт", "%", "балл", "чел", "клиент"] },
];
const ALL_UNITS = UNIT_GROUPS.flatMap((g) => g.units);

export function MetricSettingsPanel({ metric, onChanged }: Props) {
  const [busy, setBusy] = useState<string | null>(null);

  const patch = async (updates: Partial<PlanningMetric>, label: string) => {
    setBusy(label);
    // Оптимистично — в store, чтобы карточка в колонке поменялась сразу.
    usePlanningStore.setState((s) => ({
      metrics: s.metrics.map((m) => (m.id === metric.id ? { ...m, ...updates } : m)),
    }));
    markLocalMutation();
    const res = await fetch(`/api/planning/metrics/${metric.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updates),
    });
    setBusy(null);
    if (!res.ok) { toast.error(`Не удалось сохранить «${label}»`); return; }
    onChanged();
  };

  // Per concept §3.3 — fields differ by metric type:
  //   delivery   — list of initiatives × deadline matrix; no unit/baseline/source/cumulative.
  //   business   — money/count metric; source ∈ {second_brain, manual}; usually cumulative.
  //   numeric    — full set of fields.
  const isDelivery = metric.type === "delivery";
  const isBusiness = metric.type === "business";

  if (isDelivery) {
    return (
      <div className="rounded-md border border-dashed border-slate-200 bg-slate-50 p-3 text-xs text-slate-500">
        <p className="font-medium text-slate-700">Метрика-выполнение</p>
        <p className="mt-1">
          Прогресс считается по матрице «инициатива × попала в дедлайн».
          Единица измерения и источник факта не применяются.
          Добавьте связанные инициативы внизу — они станут пунктами выполнения.
        </p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-3">
      <Field label="Единица измерения" hint="Кликните, чтобы выбрать">
        <div className="flex flex-col gap-1">
          {UNIT_GROUPS.map((g) => (
            <div key={g.label} className="flex items-center gap-1">
              <span className="w-14 shrink-0 text-[10px] uppercase tracking-wide text-slate-400">{g.label}</span>
              <div className="flex flex-wrap gap-1">
                {g.units.map((u) => (
                  <button
                    key={u}
                    onClick={() => patch({ unit: u }, "единица")}
                    className={`rounded-md border px-1.5 py-0.5 text-[11px] ${
                      metric.unit === u ? "border-blue-500 bg-blue-50 text-blue-700" : "border-slate-200 text-slate-600 hover:bg-slate-50"
                    }`}
                    disabled={busy !== null}
                  >
                    {u}
                  </button>
                ))}
              </div>
            </div>
          ))}
          <input
            type="text"
            placeholder="своя единица…"
            defaultValue={ALL_UNITS.includes(metric.unit ?? "") ? "" : (metric.unit ?? "")}
            onBlur={(e) => {
              const v = e.target.value.trim();
              if (v && v !== metric.unit) patch({ unit: v }, "единица");
            }}
            className="mt-0.5 w-full rounded-md border border-slate-200 px-2 py-0.5 text-xs"
          />
        </div>
      </Field>

      <Field label="Направление" hint="Что считаем «хорошо»">
        <div className="flex gap-1">
          {DIRECTION_OPTIONS.map((d) => (
            <button
              key={d.value}
              onClick={() => patch({ direction_value: d.value }, "направление")}
              className={`flex-1 rounded-md border px-2 py-1 text-xs ${
                metric.direction_value === d.value ? "border-blue-500 bg-blue-50 text-blue-700" : "border-slate-200 text-slate-600 hover:bg-slate-50"
              }`}
              disabled={busy !== null}
            >
              {d.label}
            </button>
          ))}
        </div>
      </Field>

      <Field label="Стартовое значение (baseline)" hint="С чего стартуем 1 января">
        <input
          type="number"
          defaultValue={metric.baseline ?? ""}
          onBlur={(e) => {
            const v = e.target.value === "" ? null : Number(e.target.value);
            if (v !== metric.baseline) patch({ baseline: v }, "baseline");
          }}
          placeholder={isBusiness ? "обычно 0" : "например, 250"}
          className="w-full rounded-md border border-slate-200 px-2 py-1 text-sm"
        />
      </Field>

      <Field label="Источник факта" hint="Откуда подтягиваются tick'и">
        <select
          value={metric.source ?? "manual"}
          onChange={(e) => patch({ source: e.target.value as MetricSource }, "источник")}
          className="w-full rounded-md border border-slate-200 px-2 py-1 text-sm"
          disabled={busy !== null}
        >
          {/* Business — only second_brain (deals/payments) or manual; tech sources hidden. */}
          {SOURCE_OPTIONS
            .filter((s) => !isBusiness || s.value === "second_brain" || s.value === "manual")
            .map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
        </select>
      </Field>

      <Field label="Накопительная?" hint={isBusiness ? "Выручка/подписания — всегда да" : "Latency/баги — нет; счётчики — да"}>
        <div className="flex gap-1">
          <button
            onClick={() => patch({ is_cumulative: true }, "накопительная")}
            className={`flex-1 rounded-md border px-2 py-1 text-xs ${
              metric.is_cumulative ? "border-blue-500 bg-blue-50 text-blue-700" : "border-slate-200 text-slate-600 hover:bg-slate-50"
            }`}
            disabled={busy !== null}
          >
            Да
          </button>
          <button
            onClick={() => patch({ is_cumulative: false }, "накопительная")}
            className={`flex-1 rounded-md border px-2 py-1 text-xs ${
              !metric.is_cumulative ? "border-blue-500 bg-blue-50 text-blue-700" : "border-slate-200 text-slate-600 hover:bg-slate-50"
            }`}
            disabled={busy !== null}
          >
            Нет
          </button>
        </div>
      </Field>

      {(metric.source === "grafana" || metric.source === "product_analytics") && (
        <Field label="ID источника" hint={metric.source === "grafana" ? "Имя метрики в Grafana" : "ID в источнике"}>
          <input
            type="text"
            defaultValue={metric.source_id ?? ""}
            onBlur={(e) => {
              const v = e.target.value.trim() || null;
              if (v !== metric.source_id) patch({ source_id: v }, "source_id");
            }}
            placeholder="например, webhook_p99"
            className="w-full rounded-md border border-slate-200 px-2 py-1 text-sm"
          />
        </Field>
      )}
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-0.5 text-xs font-medium text-slate-600">{label}</p>
      {hint && <p className="mb-1 text-[10px] text-slate-400">{hint}</p>}
      {children}
    </div>
  );
}
