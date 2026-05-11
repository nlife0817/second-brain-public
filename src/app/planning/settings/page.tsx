"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import type { PlanningSettings, PlanningIcpSegment, PlanningKaitenBoardMapping, PlanningInitiative, PlanningMetricUnit } from "@/types/planning";

export default function PlanningSettingsPage() {
  const [settings, setSettings] = useState<PlanningSettings | null>(null);
  const [segments, setSegments] = useState<PlanningIcpSegment[]>([]);
  const [mappings, setMappings] = useState<PlanningKaitenBoardMapping[]>([]);
  const [initiatives, setInitiatives] = useState<PlanningInitiative[]>([]);
  const [units, setUnits] = useState<PlanningMetricUnit[]>([]);
  const [newSegment, setNewSegment] = useState("");
  const [newUnitCode, setNewUnitCode] = useState("");
  const [newUnitTitle, setNewUnitTitle] = useState("");
  const [boardId, setBoardId] = useState("");
  const [boardInit, setBoardInit] = useState("");

  const fetchAll = async () => {
    const [s, seg, m, i, u] = await Promise.all([
      fetch("/api/planning/settings").then((r) => r.ok ? r.json() : null),
      fetch("/api/planning/icp-segments").then((r) => r.ok ? r.json() : []),
      fetch("/api/planning/kaiten-mapping").then((r) => r.ok ? r.json() : []),
      fetch("/api/planning/initiatives").then((r) => r.ok ? r.json() : []),
      fetch("/api/planning/metric-units").then((r) => r.ok ? r.json() : []),
    ]);
    setSettings(s); setSegments(seg); setMappings(m); setInitiatives(i); setUnits(u);
  };
  useEffect(() => { fetchAll(); }, []);

  const updateField = async (k: keyof PlanningSettings, v: number | string | boolean) => {
    const res = await fetch("/api/planning/settings", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [k]: v }),
    });
    if (!res.ok) { toast.error("Не удалось"); return; }
    setSettings(await res.json());
  };

  const addSegment = async () => {
    if (!newSegment.trim()) return;
    const res = await fetch("/api/planning/icp-segments", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: newSegment.trim() }),
    });
    if (!res.ok) { toast.error("Не удалось"); return; }
    setNewSegment(""); fetchAll();
  };

  const deleteSegment = async (id: string) => {
    if (!confirm("Удалить сегмент?")) return;
    const res = await fetch(`/api/planning/icp-segments/${id}`, { method: "DELETE" });
    if (!res.ok) { toast.error("Не удалось"); return; }
    fetchAll();
  };

  const addUnit = async () => {
    if (!newUnitCode.trim() || !newUnitTitle.trim()) return;
    const res = await fetch("/api/planning/metric-units", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: newUnitCode.trim(), title: newUnitTitle.trim() }),
    });
    if (!res.ok) { toast.error("Не удалось"); return; }
    setNewUnitCode(""); setNewUnitTitle(""); fetchAll();
  };

  const deleteUnit = async (code: string) => {
    if (!confirm(`Удалить единицу ${code}?`)) return;
    const res = await fetch(`/api/planning/metric-units/${code}`, { method: "DELETE" });
    if (!res.ok) { toast.error("Не удалось"); return; }
    fetchAll();
  };

  const addMapping = async () => {
    if (!boardId || !boardInit) return;
    const res = await fetch("/api/planning/kaiten-mapping", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kaiten_board_id: boardId, initiative_id: boardInit }),
    });
    if (!res.ok) { toast.error("Не удалось"); return; }
    setBoardId(""); setBoardInit(""); fetchAll();
  };

  const removeMapping = async (boardId: string) => {
    const res = await fetch("/api/planning/kaiten-mapping", {
      method: "DELETE", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kaiten_board_id: boardId }),
    });
    if (!res.ok) { toast.error("Не удалось"); return; }
    fetchAll();
  };

  if (!settings) return <div className="p-6 text-sm text-slate-500">Загрузка…</div>;

  return (
    <div className="p-6">
      <h1 className="mb-4 text-2xl font-semibold">Настройки планирования</h1>

      {/* Settings */}
      <section className="rounded-xl border border-slate-200 p-4">
        <h2 className="mb-3 text-sm font-semibold">Параметры</h2>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <NumField label="Длительность пилота (дней)" value={settings.pilot_default_duration_days} onChange={(v) => updateField("pilot_default_duration_days", v)} />
          <NumField label="Раннее предупреждение (недель)" value={settings.early_warning_weeks} onChange={(v) => updateField("early_warning_weeks", v)} />
          <NumField label="Доля стратегии" value={settings.strategy_support_ratio} step={0.05} onChange={(v) => updateField("strategy_support_ratio", v)} />
          <NumField label="Порог минорной правки" value={settings.minor_adjustment_threshold} step={0.01} onChange={(v) => updateField("minor_adjustment_threshold", v)} />
          <NumField label="Дневная capacity (ч)" value={settings.daily_capacity_hours} onChange={(v) => updateField("daily_capacity_hours", v)} />
          <NumField label="Недельная capacity (ч)" value={settings.weekly_capacity_hours} onChange={(v) => updateField("weekly_capacity_hours", v)} />
          <label className="text-sm">
            Цвет акцента
            <input type="color" defaultValue={settings.accent_color} onBlur={(e) => updateField("accent_color", e.target.value)} className="mt-1 block h-9 w-full rounded-md border border-slate-300 px-2" />
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={settings.weekend_days_visible} onChange={(e) => updateField("weekend_days_visible", e.target.checked)} />
            Показывать СБ/ВС в недельной сетке
          </label>
        </div>
      </section>

      {/* Kaiten mapping */}
      <section className="mt-4 rounded-xl border border-slate-200 p-4">
        <h2 className="mb-3 text-sm font-semibold">Маппинг досок Kaiten → Инициатива</h2>
        <div className="mb-3 flex gap-2">
          <input value={boardId} onChange={(e) => setBoardId(e.target.value)} placeholder="Kaiten board ID" className="rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
          <select value={boardInit} onChange={(e) => setBoardInit(e.target.value)} className="rounded-md border border-slate-300 px-2 py-1.5 text-sm">
            <option value="">— Инициатива —</option>
            {initiatives.map((i) => <option key={i.id} value={i.id}>{i.title}</option>)}
          </select>
          <button onClick={addMapping} className="rounded-md bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700">Добавить</button>
        </div>
        <ul className="text-sm">
          {mappings.length === 0 && <li className="text-xs text-slate-400">Маппингов нет</li>}
          {mappings.map((m) => {
            const ini = initiatives.find((i) => i.id === m.initiative_id);
            return (
              <li key={m.kaiten_board_id} className="flex items-center justify-between border-b border-slate-100 py-1">
                <span>Board #{m.kaiten_board_id} → {ini?.title ?? m.initiative_id}</span>
                <button onClick={() => removeMapping(m.kaiten_board_id)} className="text-xs text-red-600 hover:underline">Удалить</button>
              </li>
            );
          })}
        </ul>
      </section>

      {/* ICP segments */}
      <section className="mt-4 rounded-xl border border-slate-200 p-4">
        <h2 className="mb-3 text-sm font-semibold">Сегменты клиентов (ICP)</h2>
        <div className="mb-3 flex gap-2">
          <input
            value={newSegment}
            onChange={(e) => setNewSegment(e.target.value)}
            placeholder="Новый сегмент"
            onKeyDown={(e) => { if (e.key === "Enter") addSegment(); }}
            className="flex-1 rounded-md border border-slate-300 px-2 py-1.5 text-sm"
          />
          <button onClick={addSegment} disabled={!newSegment.trim()} className="rounded-md bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700 disabled:opacity-50">Добавить</button>
        </div>
        <ul className="text-sm">
          {segments.length === 0 && <li className="text-xs text-slate-400">Сегментов нет</li>}
          {segments.map((s) => (
            <li key={s.id} className="flex items-center justify-between border-b border-slate-100 py-1">
              <span>{s.title}</span>
              <button onClick={() => deleteSegment(s.id)} className="text-xs text-red-600 hover:text-red-700" title="Удалить">
                <Trash2 className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      </section>

      {/* Metric units */}
      <section className="mt-4 rounded-xl border border-slate-200 p-4">
        <h2 className="mb-3 text-sm font-semibold">Единицы измерения метрик</h2>
        <div className="mb-3 flex gap-2">
          <input
            value={newUnitCode}
            onChange={(e) => setNewUnitCode(e.target.value)}
            placeholder="Код (ms, rub, ...)"
            className="w-32 rounded-md border border-slate-300 px-2 py-1.5 text-sm"
          />
          <input
            value={newUnitTitle}
            onChange={(e) => setNewUnitTitle(e.target.value)}
            placeholder="Название (ms, ₽, ...)"
            className="flex-1 rounded-md border border-slate-300 px-2 py-1.5 text-sm"
          />
          <button onClick={addUnit} disabled={!newUnitCode.trim() || !newUnitTitle.trim()} className="rounded-md bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700 disabled:opacity-50">Добавить</button>
        </div>
        <ul className="text-sm">
          {units.map((u) => (
            <li key={u.code} className="flex items-center justify-between border-b border-slate-100 py-1">
              <span><code className="rounded bg-slate-100 px-1 text-[11px]">{u.code}</code> · {u.title}{u.is_default ? " · по умолчанию" : ""}</span>
              <button onClick={() => deleteUnit(u.code)} className="text-xs text-red-600 hover:text-red-700" title="Удалить">
                <Trash2 className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function NumField({ label, value, onChange, step }: { label: string; value: number; onChange: (v: number) => void; step?: number }) {
  return (
    <label className="text-sm">
      {label}
      <input
        type="number"
        defaultValue={value}
        step={step ?? 1}
        onBlur={(e) => {
          const v = Number(e.target.value);
          if (!Number.isFinite(v)) return;
          onChange(v);
        }}
        className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
      />
    </label>
  );
}
