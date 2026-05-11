"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import type { PlanningSettings, PlanningIcpSegment, PlanningKaitenBoardMapping, PlanningInitiative, PlanningMetricUnit } from "@/types/planning";
import type { DevelopmentParticipant, ParticipantRole } from "@/types";

export default function PlanningSettingsPage() {
  const [settings, setSettings] = useState<PlanningSettings | null>(null);
  const [segments, setSegments] = useState<PlanningIcpSegment[]>([]);
  const [mappings, setMappings] = useState<PlanningKaitenBoardMapping[]>([]);
  const [initiatives, setInitiatives] = useState<PlanningInitiative[]>([]);
  const [units, setUnits] = useState<PlanningMetricUnit[]>([]);
  const [participants, setParticipants] = useState<DevelopmentParticipant[]>([]);
  const [newSegment, setNewSegment] = useState("");
  const [newUnitCode, setNewUnitCode] = useState("");
  const [newUnitTitle, setNewUnitTitle] = useState("");
  const [boardId, setBoardId] = useState("");
  const [boardInit, setBoardInit] = useState("");
  const [newParticipantName, setNewParticipantName] = useState("");
  const [newParticipantRole, setNewParticipantRole] = useState<Exclude<ParticipantRole, "owner">>("developer");

  const fetchAll = async () => {
    const [s, seg, m, i, u, p] = await Promise.all([
      fetch("/api/planning/settings").then((r) => r.ok ? r.json() : null),
      fetch("/api/planning/icp-segments").then((r) => r.ok ? r.json() : []),
      fetch("/api/planning/kaiten-mapping").then((r) => r.ok ? r.json() : []),
      fetch("/api/planning/initiatives").then((r) => r.ok ? r.json() : []),
      fetch("/api/planning/metric-units").then((r) => r.ok ? r.json() : []),
      fetch("/api/development-participants").then((r) => r.ok ? r.json() : []),
    ]);
    setSettings(s); setSegments(seg); setMappings(m); setInitiatives(i); setUnits(u); setParticipants(p);
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

  const addParticipant = async () => {
    if (!newParticipantName.trim()) return;
    const res = await fetch("/api/development-participants", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newParticipantName.trim(), role: newParticipantRole }),
    });
    if (!res.ok) { toast.error("Не удалось добавить участника"); return; }
    setNewParticipantName(""); setNewParticipantRole("developer"); fetchAll();
  };

  const updateParticipant = async (id: string, patch: Partial<DevelopmentParticipant>) => {
    // Оптимистично
    setParticipants((prev) => prev.map((p) => p.id === id ? { ...p, ...patch } : p));
    const res = await fetch(`/api/development-participants/${id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (!res.ok) { toast.error("Не удалось обновить"); fetchAll(); }
    else {
      const fresh = await res.json();
      setParticipants((prev) => prev.map((p) => p.id === id ? fresh : p));
    }
  };

  const deleteParticipant = async (id: string) => {
    if (!confirm("Удалить участника? Если у него есть задачи — назначение слетит на дефолт.")) return;
    const res = await fetch(`/api/development-participants/${id}`, { method: "DELETE" });
    if (res.status === 409) { toast.error("Системный участник «Я» не удаляется"); return; }
    if (!res.ok) { toast.error("Не удалось удалить"); return; }
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

      {/* Participants */}
      <section className="mt-4 rounded-xl border border-slate-200 p-4">
        <h2 className="mb-3 text-sm font-semibold">Участники</h2>
        <div className="mb-3 grid grid-cols-[1fr_140px_120px_auto] items-end gap-2">
          <label className="text-xs text-slate-600">
            Имя
            <input
              value={newParticipantName}
              onChange={(e) => setNewParticipantName(e.target.value)}
              placeholder="Иван Петров"
              onKeyDown={(e) => { if (e.key === "Enter") addParticipant(); }}
              className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            />
          </label>
          <label className="text-xs text-slate-600">
            Роль
            <select
              value={newParticipantRole}
              onChange={(e) => setNewParticipantRole(e.target.value as Exclude<ParticipantRole, "owner">)}
              className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            >
              <option value="developer">developer</option>
              <option value="other">other</option>
            </select>
          </label>
          <span className="text-[11px] text-slate-400">часы по умолч. — 40</span>
          <button
            onClick={addParticipant}
            disabled={!newParticipantName.trim()}
            className="rounded-md bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
          >
            Добавить
          </button>
        </div>
        <div className="grid grid-cols-[1fr_120px_100px_120px_auto] gap-2 border-b border-slate-200 pb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
          <span>Имя</span>
          <span>Роль</span>
          <span>Активен</span>
          <span>Часы/нед</span>
          <span></span>
        </div>
        <ul className="text-sm">
          {participants.length === 0 && (
            <li className="py-2 text-xs text-slate-400">Участников нет</li>
          )}
          {participants.map((p) => {
            const isOwner = p.role === "owner";
            return (
              <li key={p.id} className="grid grid-cols-[1fr_120px_100px_120px_auto] items-center gap-2 border-b border-slate-100 py-1.5">
                <input
                  defaultValue={p.name}
                  onBlur={(e) => {
                    const v = e.target.value.trim();
                    if (v && v !== p.name) updateParticipant(p.id, { name: v });
                  }}
                  className="rounded-md border border-slate-200 bg-white px-2 py-1 text-sm"
                />
                <select
                  value={p.role}
                  disabled={isOwner}
                  onChange={(e) => updateParticipant(p.id, { role: e.target.value as ParticipantRole })}
                  className="rounded-md border border-slate-200 bg-white px-2 py-1 text-sm disabled:bg-slate-100 disabled:text-slate-500"
                  title={isOwner ? "Роль владельца не меняется" : ""}
                >
                  <option value="developer">developer</option>
                  <option value="owner" disabled>owner</option>
                  <option value="other">other</option>
                </select>
                <label className="inline-flex items-center gap-1.5 text-xs text-slate-600">
                  <input
                    type="checkbox"
                    checked={p.is_active}
                    disabled={isOwner}
                    onChange={(e) => updateParticipant(p.id, { is_active: e.target.checked })}
                    title={isOwner ? "Владельца нельзя деактивировать" : ""}
                  />
                  {p.is_active ? "да" : "нет"}
                  {!p.is_active && p.deactivated_at && (
                    <span className="text-[10px] text-slate-400">с {p.deactivated_at.slice(0, 10)}</span>
                  )}
                </label>
                <input
                  type="number"
                  min={0}
                  step={1}
                  defaultValue={Number(p.weekly_hours_default)}
                  onBlur={(e) => {
                    const v = Number(e.target.value);
                    if (Number.isFinite(v) && v >= 0 && v !== Number(p.weekly_hours_default)) {
                      updateParticipant(p.id, { weekly_hours_default: v });
                    }
                  }}
                  className="rounded-md border border-slate-200 bg-white px-2 py-1 text-sm tabular-nums"
                />
                <button
                  onClick={() => deleteParticipant(p.id)}
                  disabled={isOwner}
                  className="text-xs text-red-600 hover:text-red-700 disabled:cursor-not-allowed disabled:text-slate-300"
                  title={isOwner ? "Владельца нельзя удалить" : "Удалить"}
                >
                  <Trash2 className="size-3.5" />
                </button>
              </li>
            );
          })}
        </ul>
        <p className="mt-2 text-[10px] text-slate-400">
          «Я» (owner) — системный участник, дефолтный исполнитель новой задачи. Не удаляется и не деактивируется.
        </p>
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
