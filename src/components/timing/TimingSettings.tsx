"use client";

import { useEffect, useState } from "react";
import { Clock, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import type { PomodoroMode, TimingSettings } from "@/types";

export function TimingSettingsCard() {
  const [settings, setSettings] = useState<TimingSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  useEffect(() => {
    fetch("/api/timing/settings")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => setSettings(data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const update = (patch: Partial<TimingSettings>) => {
    setSettings((s) => (s ? { ...s, ...patch } : s));
  };

  const handleSave = async () => {
    if (!settings) return;
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch("/api/timing/settings", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          idle_threshold_min: settings.idle_threshold_min,
          reminder_interval_min: settings.reminder_interval_min,
          hard_cap_hours: settings.hard_cap_hours,
          default_pomodoro: settings.default_pomodoro,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? `Ошибка ${res.status}`);
      }
      const updated = await res.json();
      setSettings(updated);
      setMessage({ kind: "ok", text: "Настройки сохранены" });
    } catch (e) {
      setMessage({ kind: "err", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <section className="rounded-xl border border-slate-200/80 bg-white p-3.5 shadow-sm">
        <div className="text-sm text-slate-500">Загрузка настроек таймера…</div>
      </section>
    );
  }

  if (!settings) {
    return (
      <section className="rounded-xl border border-slate-200/80 bg-white p-3.5 shadow-sm">
        <div className="text-sm text-red-500">Не удалось загрузить настройки таймера</div>
      </section>
    );
  }

  return (
    <section className="rounded-xl border border-slate-200/80 bg-white p-3.5 shadow-sm">
      <div className="mb-3 flex items-center gap-2">
        <Clock className="size-4 text-emerald-600" />
        <span className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-500">
          Учёт времени
        </span>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <NumberField
          label="Idle-порог, мин"
          hint="Через сколько без активности предложить дискард idle (1–120)"
          min={1}
          max={120}
          value={settings.idle_threshold_min}
          onChange={(n) => update({ idle_threshold_min: n })}
        />
        <NumberField
          label="Напоминание, мин"
          hint="Каждые N минут — push «таймер всё ещё идёт» (5–600)"
          min={5}
          max={600}
          value={settings.reminder_interval_min}
          onChange={(n) => update({ reminder_interval_min: n })}
        />
        <NumberField
          label="Hard-cap, часов"
          hint="После N часов без heartbeat — автостоп (1–24)"
          min={1}
          max={24}
          value={settings.hard_cap_hours}
          onChange={(n) => update({ hard_cap_hours: n })}
        />
        <div>
          <label className="block text-xs font-medium text-slate-600">Pomodoro по умолчанию</label>
          <p className="mt-0.5 text-[11px] text-slate-500">Какой режим предлагать при старте</p>
          <Select
            value={settings.default_pomodoro ?? "off"}
            onValueChange={(v) =>
              update({ default_pomodoro: v === "off" ? null : (v as PomodoroMode) })
            }
          >
            <SelectTrigger className="mt-1.5 h-8 w-full text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="off">Выкл</SelectItem>
              <SelectItem value="25_5">25 мин фокус / 5 мин перерыв</SelectItem>
              <SelectItem value="50_10">50 мин фокус / 10 мин перерыв</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="mt-4 flex items-center gap-2">
        <Button onClick={handleSave} disabled={saving} size="sm">
          {saving && <Loader2 className="animate-spin" />}
          Сохранить
        </Button>
        {message && (
          <span
            className={
              message.kind === "ok" ? "text-xs text-emerald-600" : "text-xs text-red-500"
            }
          >
            {message.text}
          </span>
        )}
      </div>
    </section>
  );
}

function NumberField({
  label,
  hint,
  min,
  max,
  value,
  onChange,
}: {
  label: string;
  hint?: string;
  min: number;
  max: number;
  value: number;
  onChange: (n: number) => void;
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-slate-600">{label}</label>
      {hint && <p className="mt-0.5 text-[11px] text-slate-500">{hint}</p>}
      <Input
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={(e) => {
          const n = Number.parseInt(e.target.value, 10);
          if (Number.isFinite(n)) onChange(n);
        }}
        className="mt-1.5 h-8 text-sm"
      />
    </div>
  );
}
