"use client";

import { useState } from "react";
import { toast } from "sonner";
import type { PlanningMetric, MetricDirection, MetricSource } from "@/types/planning";

interface Props {
  metric: PlanningMetric;
  onChanged: () => void;
}

const DIRECTION_OPTIONS: Array<{ value: MetricDirection; label: string }> = [
  { value: "up",   label: "Вверх (рост = хорошо)" },
  { value: "down", label: "Вниз (снижение = хорошо)" },
];

const SOURCE_OPTIONS: Array<{ value: MetricSource; label: string }> = [
  { value: "manual",            label: "Ручной ввод" },
  { value: "kaiten",            label: "Kaiten" },
  { value: "grafana",           label: "Grafana" },
  { value: "second_brain",      label: "Second Brain (сделки/задачи)" },
  { value: "product_analytics", label: "Product Analytics" },
];

const COMMON_UNITS = ["₽", "$", "шт", "%", "ms", "sec", "rps", "GB", "MB"];

export function MetricSettingsPanel({ metric, onChanged }: Props) {
  const [busy, setBusy] = useState<string | null>(null);

  const patch = async (updates: Partial<PlanningMetric>, label: string) => {
    setBusy(label);
    const res = await fetch(`/api/planning/metrics/${metric.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updates),
    });
    setBusy(null);
    if (!res.ok) { toast.error(`Не удалось сохранить «${label}»`); return; }
    onChanged();
  };

  return (
    <div className="grid grid-cols-2 gap-3">
      <Field label="Единица измерения" hint="₽, ms, шт, % …">
        <div className="flex flex-wrap gap-1">
          {COMMON_UNITS.map((u) => (
            <button
              key={u}
              onClick={() => patch({ unit: u }, "единица")}
              className={`rounded-md border px-2 py-0.5 text-xs ${
                metric.unit === u ? "border-blue-500 bg-blue-50 text-blue-700" : "border-slate-200 text-slate-600 hover:bg-slate-50"
              }`}
              disabled={busy !== null}
            >
              {u}
            </button>
          ))}
          <input
            type="text"
            placeholder="своя…"
            defaultValue={COMMON_UNITS.includes(metric.unit ?? "") ? "" : (metric.unit ?? "")}
            onBlur={(e) => {
              const v = e.target.value.trim();
              if (v && v !== metric.unit) patch({ unit: v }, "единица");
            }}
            className="w-16 rounded-md border border-slate-200 px-2 py-0.5 text-xs"
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
          placeholder="например, 250"
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
          {SOURCE_OPTIONS.map((s) => (
            <option key={s.value} value={s.value}>{s.label}</option>
          ))}
        </select>
      </Field>

      <Field label="Накопительная?" hint="Бизнес-метрики (выручка) — да; latency — нет">
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

      {(metric.source === "kaiten" || metric.source === "grafana" || metric.source === "product_analytics") && (
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
