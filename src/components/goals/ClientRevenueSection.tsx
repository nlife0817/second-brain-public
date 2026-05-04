"use client";

import { useEffect, useMemo, useState } from "react";
import { useBrainStore } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, Copy, Trash2, UserMinus, UserCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ClientRevenueEntry, GoalFull } from "@/types";

interface Props {
  goal: GoalFull;
}

export function ClientRevenueSection({ goal }: Props) {
  const allClients = useBrainStore((s) => s.clients);
  const goals = useBrainStore((s) => s.goals);

  const [entries, setEntries] = useState<ClientRevenueEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [pickClientId, setPickClientId] = useState("");
  const [pickAmount, setPickAmount] = useState("");

  async function load(): Promise<void> {
    setLoading(true);
    try {
      const r = await fetch(`/api/goals/${goal.id}/clients`);
      if (r.ok) setEntries(await r.json());
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [goal.id]);

  const usedClientIds = useMemo(() => new Set(entries.map((e) => e.client_id)), [entries]);
  const availableClients = useMemo(
    () => allClients.filter((c) => !usedClientIds.has(c.id)),
    [allClients, usedClientIds],
  );

  // Find the previous-week sibling (same parent_id, period_start strictly
  // earlier) to copy its roster.
  const previousWeek = useMemo(() => {
    if (!goal.period_start) return null;
    const siblings = goals.filter(
      (g) => g.parent_id === goal.parent_id && g.level === "week" && g.id !== goal.id && g.period_start,
    );
    siblings.sort((a, b) => (a.period_start ?? "").localeCompare(b.period_start ?? ""));
    const earlier = siblings.filter((g) => (g.period_start ?? "") < goal.period_start!);
    return earlier[earlier.length - 1] ?? null;
  }, [goals, goal.parent_id, goal.id, goal.period_start]);

  async function copyFromPrev(): Promise<void> {
    if (!previousWeek || busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`/api/goals/${previousWeek.id}/clients`);
      if (!r.ok) throw new Error("Не удалось загрузить прошлую неделю");
      const prev: ClientRevenueEntry[] = await r.json();
      // Skip churned entries from prev — they shouldn't carry over by default.
      const toCopy = prev.filter((e) => e.status !== "churned" && !usedClientIds.has(e.client_id));
      for (const e of toCopy) {
        await fetch(`/api/goals/${goal.id}/clients`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ client_id: e.client_id, amount: e.amount, status: "active", notes: e.notes }),
        });
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка копирования");
    } finally {
      setBusy(false);
    }
  }

  async function addEntry(): Promise<void> {
    if (!pickClientId || busy) return;
    setBusy(true);
    setError(null);
    try {
      const amt = pickAmount === "" ? 0 : Number(pickAmount);
      const r = await fetch(`/api/goals/${goal.id}/clients`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client_id: pickClientId, amount: Number.isFinite(amt) ? amt : 0 }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error((j as { error?: string }).error ?? `HTTP ${r.status}`);
      }
      const created: ClientRevenueEntry = await r.json();
      setEntries((p) => [...p, created]);
      setPickClientId("");
      setPickAmount("");
      setAdding(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка добавления");
    } finally {
      setBusy(false);
    }
  }

  async function patch(id: string, patch: Partial<Pick<ClientRevenueEntry, "amount" | "status" | "notes">>): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`/api/goals/${goal.id}/clients/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const updated: ClientRevenueEntry = await r.json();
      setEntries((p) => p.map((e) => (e.id === id ? updated : e)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка");
    } finally {
      setBusy(false);
    }
  }

  async function removeEntry(id: string): Promise<void> {
    if (!confirm("Удалить клиента из этой недели?")) return;
    setBusy(true);
    try {
      const r = await fetch(`/api/goals/${goal.id}/clients/${id}`, { method: "DELETE" });
      if (r.ok) setEntries((p) => p.filter((e) => e.id !== id));
    } finally {
      setBusy(false);
    }
  }

  const total = entries.reduce((s, e) => s + (e.status === "active" ? Number(e.amount) : 0), 0);
  const activeCount = entries.filter((e) => e.status === "active").length;

  return (
    <section>
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-[11px] font-semibold uppercase tracking-widest text-slate-500">
          Клиенты с выручкой
        </h3>
        <div className="flex items-center gap-1">
          {previousWeek && entries.length === 0 && (
            <button
              onClick={copyFromPrev}
              disabled={busy}
              className="flex items-center gap-1 rounded-md bg-violet-50 px-2 py-1 text-[10px] font-medium text-violet-700 hover:bg-violet-100 disabled:opacity-50"
              title={`Скопировать клиентов с недели ${previousWeek.period_start ?? ""}`}
            >
              <Copy className="size-3" /> С прошлой недели
            </button>
          )}
          <button
            onClick={() => setAdding((v) => !v)}
            className="flex size-6 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-900"
            title="Добавить клиента"
          >
            <Plus className="size-3.5" />
          </button>
        </div>
      </div>

      {loading ? (
        <p className="text-[11px] text-slate-400">Загрузка…</p>
      ) : entries.length === 0 && !adding ? (
        <p className="rounded-lg border border-dashed border-slate-200 p-3 text-center text-[11px] text-slate-400">
          Никого нет. Добавь клиентов или скопируй с прошлой недели.
        </p>
      ) : (
        <div className="space-y-1">
          {entries.map((e) => (
            <ClientRevenueRow
              key={e.id}
              entry={e}
              busy={busy}
              onAmount={(v) => patch(e.id, { amount: v })}
              onStatus={(v) => patch(e.id, { status: v })}
              onDelete={() => removeEntry(e.id)}
            />
          ))}
        </div>
      )}

      {adding && (
        <div className="mt-2 rounded-md border border-slate-200 bg-slate-50/40 p-2">
          <select
            value={pickClientId}
            onChange={(ev) => setPickClientId(ev.target.value)}
            className="h-7 w-full rounded-md border border-slate-200 bg-white px-2 text-xs"
          >
            <option value="">— выбрать клиента —</option>
            {availableClients.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          <div className="mt-2 flex items-center gap-1.5">
            <Input
              type="number"
              placeholder="Сумма"
              value={pickAmount}
              onChange={(ev) => setPickAmount(ev.target.value)}
              className="h-7 text-xs tabular-nums"
            />
            <Button size="sm" onClick={addEntry} disabled={!pickClientId || busy}>
              Добавить
            </Button>
            <Button size="sm" variant="outline" onClick={() => { setAdding(false); setPickClientId(""); setPickAmount(""); }}>
              Отмена
            </Button>
          </div>
        </div>
      )}

      {entries.length > 0 && (
        <div className="mt-2 flex items-center justify-between rounded-md bg-slate-50 px-2.5 py-1.5 text-[11px]">
          <span className="text-slate-500">Активных: {activeCount}</span>
          <span className="tabular-nums font-medium text-slate-900">
            ∑ {total.toLocaleString("ru-RU")} ₽
          </span>
        </div>
      )}

      {error && <p className="mt-1 text-[11px] text-rose-600">{error}</p>}
    </section>
  );
}

function ClientRevenueRow({
  entry, busy, onAmount, onStatus, onDelete,
}: {
  entry: ClientRevenueEntry;
  busy: boolean;
  onAmount: (v: number) => void;
  onStatus: (v: "active" | "churned") => void;
  onDelete: () => void;
}) {
  const [value, setValue] = useState(String(entry.amount));
  useEffect(() => { setValue(String(entry.amount)); }, [entry.amount]);
  const isChurned = entry.status === "churned";
  return (
    <div className={cn(
      "flex items-center gap-2 rounded-md border px-2 py-1 text-[11px]",
      isChurned ? "border-rose-100 bg-rose-50/40" : "border-slate-200 bg-white",
    )}>
      <span className={cn(
        "min-w-0 flex-1 truncate",
        isChurned ? "text-rose-700 line-through" : "text-slate-800",
      )}>
        {entry.client_name ?? "(удалён)"}
      </span>
      <Input
        type="number"
        value={value}
        onChange={(ev) => setValue(ev.target.value)}
        onBlur={() => {
          const n = Number(value);
          if (Number.isFinite(n) && n !== Number(entry.amount)) onAmount(n);
        }}
        disabled={busy || isChurned}
        className="h-6 w-24 text-[11px] tabular-nums"
      />
      <button
        onClick={() => onStatus(isChurned ? "active" : "churned")}
        disabled={busy}
        className={cn(
          "rounded p-1",
          isChurned ? "text-emerald-600 hover:bg-emerald-50" : "text-slate-400 hover:bg-slate-100 hover:text-rose-500",
        )}
        title={isChurned ? "Вернуть в активные" : "Отметить как отвалившегося"}
      >
        {isChurned ? <UserCheck className="size-3" /> : <UserMinus className="size-3" />}
      </button>
      <button
        onClick={onDelete}
        disabled={busy}
        className="text-slate-300 hover:text-red-500"
        title="Удалить запись"
      >
        <Trash2 className="size-3" />
      </button>
    </div>
  );
}
