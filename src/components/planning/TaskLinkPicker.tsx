"use client";

import { useMemo, useState } from "react";
import { X, Search } from "lucide-react";
import { usePlanningStore } from "@/lib/planning-store";

interface Props {
  initiativeId: string;
  excludeIds: Set<string>;
  open: boolean;
  onClose: () => void;
}

// Picker для bulk-привязки существующих задач к инициативе (P3).
// Показывает items.type === 'task', не привязанные ещё к этой инициативе.

export function TaskLinkPicker({ initiativeId, excludeIds, open, onClose }: Props) {
  const allTasks = usePlanningStore((s) => s.tasks);
  const linkItems = usePlanningStore((s) => s.linkItemsToInitiative);

  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const candidates = useMemo(() => {
    const q = query.trim().toLowerCase();
    return allTasks.filter((t) => {
      if (excludeIds.has(t.id)) return false;
      if (t.parent_id) return false; // подзадачи привязываются неявно через parent
      if (t.status === "archived") return false;
      if (!q) return true;
      return (
        t.title.toLowerCase().includes(q) ||
        (t.why ?? "").toLowerCase().includes(q)
      );
    });
  }, [allTasks, excludeIds, query]);

  if (!open) return null;

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const onConfirm = async () => {
    if (selected.size === 0) return;
    setBusy(true);
    await linkItems(initiativeId, Array.from(selected));
    setBusy(false);
    setSelected(new Set());
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="flex w-full max-w-lg flex-col rounded-lg bg-white shadow-xl">
        <header className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <h2 className="text-sm font-semibold">Привязать существующие задачи</h2>
          <button onClick={onClose} className="rounded-md p-1 text-slate-400 hover:bg-slate-100">
            <X className="size-4" />
          </button>
        </header>

        <div className="border-b border-slate-100 px-4 py-2">
          <div className="flex items-center gap-2 rounded-md border border-slate-300 px-2 py-1.5">
            <Search className="size-3.5 text-slate-400" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Поиск по заголовку или why…"
              autoFocus
              className="flex-1 bg-transparent text-sm outline-none"
            />
          </div>
        </div>

        <div className="max-h-[50vh] overflow-y-auto">
          {candidates.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-slate-500">
              {query ? "Ничего не найдено" : "Нет задач, доступных для привязки"}
            </p>
          ) : (
            candidates.map((t) => (
              <label
                key={t.id}
                className="flex cursor-pointer items-start gap-2 border-b border-slate-100 px-4 py-2 last:border-b-0 hover:bg-slate-50"
              >
                <input
                  type="checkbox"
                  checked={selected.has(t.id)}
                  onChange={() => toggle(t.id)}
                  className="mt-0.5"
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{t.title}</div>
                  {t.why && (
                    <div className="truncate text-xs text-slate-500" title={t.why}>
                      {t.why}
                    </div>
                  )}
                  <div className="mt-0.5 flex items-center gap-2 text-[10px] text-slate-400">
                    <span>{t.status}</span>
                    {t.category && <span>· {t.category}</span>}
                    {t.estimated_minutes != null && (
                      <span>· {(t.estimated_minutes / 60).toFixed(1).replace(".0", "")}ч</span>
                    )}
                  </div>
                </div>
              </label>
            ))
          )}
        </div>

        <footer className="flex items-center justify-between border-t border-slate-200 px-4 py-3">
          <span className="text-xs text-slate-500">Выбрано: {selected.size}</span>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="rounded-md px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100"
            >
              Отмена
            </button>
            <button
              onClick={onConfirm}
              disabled={selected.size === 0 || busy}
              className="rounded-md bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
            >
              Привязать ({selected.size})
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
