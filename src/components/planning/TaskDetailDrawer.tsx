"use client";

import { useMemo } from "react";
import { X, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { Item, ItemStatus } from "@/types";
import { usePlanningStore } from "@/lib/planning-store";

interface Props {
  task: Item | null;
  onClose: () => void;
}

// Concept §P3: задача открывается в drawer (без inline-редактирования в таблице).
// Поля: title, status, why, category, estimate, planned_date + multi-select
// «Привязать к инициативам» (M:N).

const STATUS_OPTIONS: ItemStatus[] = ["inbox", "todo", "in_progress", "review", "done"];
const STATUS_LABEL: Record<ItemStatus, string> = {
  inbox: "Inbox",
  todo: "В очереди",
  in_progress: "В работе",
  review: "Ревью",
  done: "Сделана",
  archived: "В архиве",
};

const CATEGORIES = [
  { value: "development", label: "Разработка" },
  { value: "sales", label: "Sales" },
  { value: "account", label: "Account" },
  { value: "support", label: "Поддержка" },
  { value: "legal", label: "Legal" },
];

export function TaskDetailDrawer({ task, onClose }: Props) {
  const initiatives = usePlanningStore((s) => s.initiatives);
  const updateTask = usePlanningStore((s) => s.updateTask);
  const initiativeItemIds = usePlanningStore((s) => s.initiativeItemIds);
  const linkItems = usePlanningStore((s) => s.linkItemsToInitiative);
  const unlinkItem = usePlanningStore((s) => s.unlinkItemFromInitiative);
  const fetchInitiativeItems = usePlanningStore((s) => s.fetchInitiativeItems);

  const open = task !== null;

  // Вычисляем актуальные привязки из store-индекса (M:N) без локального state —
  // меняется store ⇒ перерисовка автоматически.
  const linkedInitiativeIds = useMemo(() => {
    if (!task) return [] as string[];
    const ids: string[] = [];
    for (const [iniId, itemIds] of Object.entries(initiativeItemIds)) {
      if (itemIds.includes(task.id)) ids.push(iniId);
    }
    return ids;
  }, [task, initiativeItemIds]);
  const linkedSet = useMemo(() => new Set(linkedInitiativeIds), [linkedInitiativeIds]);

  if (!open || !task) return null;

  const toggleInitiative = async (iniId: string) => {
    if (linkedSet.has(iniId)) {
      await unlinkItem(iniId, task.id);
    } else {
      await linkItems(iniId, [task.id]);
    }
  };

  const onDelete = async () => {
    if (!confirm(`Удалить задачу «${task.title}»?`)) return;
    const res = await fetch(`/api/items/${task.id}`, { method: "DELETE" });
    if (!res.ok) { toast.error("Не удалось удалить"); return; }
    // Re-fetch текущих инициатив, в которых она была.
    for (const iniId of linkedInitiativeIds) await fetchInitiativeItems(iniId);
    toast.success("Задача удалена");
    onClose();
  };

  const estHours = task.estimated_minutes != null ? task.estimated_minutes / 60 : null;

  return (
    <div className="fixed inset-0 z-50 flex">
      <button type="button" aria-label="Закрыть" onClick={onClose} className="flex-1 bg-black/30" />
      <aside className="flex w-[480px] flex-col overflow-y-auto bg-white shadow-xl">
        <header className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-slate-200 bg-white px-5 py-3">
          <input
            defaultValue={task.title}
            onBlur={(e) => {
              const v = e.target.value.trim();
              if (v && v !== task.title) updateTask(task.id, { title: v });
            }}
            className="flex-1 rounded-md border border-transparent px-1 py-0.5 text-lg font-semibold hover:border-slate-200 focus:border-blue-400 focus:bg-slate-50 focus:outline-none"
          />
          <button onClick={onClose} className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
            <X className="size-5" />
          </button>
        </header>

        <div className="flex flex-col gap-4 p-5">
          {/* Status + Category */}
          <section className="grid grid-cols-2 gap-3 text-sm">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-600">Статус</span>
              <select
                value={task.status}
                onChange={(e) => updateTask(task.id, { status: e.target.value as ItemStatus })}
                className="w-full rounded-md border border-slate-300 px-2 py-1.5"
              >
                {STATUS_OPTIONS.map((s) => (
                  <option key={s} value={s}>{STATUS_LABEL[s]}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-600">Категория</span>
              <select
                value={task.category ?? "development"}
                onChange={(e) => updateTask(task.id, { category: e.target.value })}
                className="w-full rounded-md border border-slate-300 px-2 py-1.5"
              >
                {CATEGORIES.map((c) => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </select>
            </label>
          </section>

          {/* Why */}
          <section>
            <span className="mb-1 block text-xs font-medium text-slate-600">Зачем (why)</span>
            <textarea
              defaultValue={task.why ?? ""}
              rows={3}
              placeholder="Что эта задача даёт инициативе"
              onBlur={(e) => {
                const v = e.target.value.trim() || null;
                if (v !== task.why) updateTask(task.id, { why: v });
              }}
              className="w-full resize-y rounded-md border border-slate-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
            />
          </section>

          {/* Estimate + planned_date */}
          <section className="grid grid-cols-2 gap-3 text-sm">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-600">Оценка (ч)</span>
              <input
                type="number"
                min={0}
                step={0.25}
                defaultValue={estHours ?? ""}
                onBlur={(e) => {
                  const v = e.target.value === "" ? null : Math.round(Number(e.target.value) * 60);
                  if (v !== task.estimated_minutes) updateTask(task.id, { estimated_minutes: v });
                }}
                className="w-full rounded-md border border-slate-300 px-2 py-1.5 tabular-nums"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-600">Запланирована на день</span>
              <input
                type="date"
                defaultValue={task.planned_date ?? ""}
                onBlur={(e) => {
                  const v = e.target.value || null;
                  if (v !== task.planned_date) updateTask(task.id, { planned_date: v });
                }}
                className="w-full rounded-md border border-slate-300 px-2 py-1.5"
              />
            </label>
          </section>

          {/* Linked initiatives — M:N picker */}
          <section className="rounded-lg border border-slate-200 p-3">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Привязана к инициативам
              </h3>
              <span className="text-[10px] text-slate-400">{linkedInitiativeIds.length}</span>
            </div>
            <div className="max-h-56 overflow-y-auto rounded-md border border-slate-100 bg-slate-50/40">
              {initiatives.length === 0 ? (
                <p className="px-2 py-2 text-xs text-slate-400">Инициатив нет</p>
              ) : (
                initiatives.map((i) => {
                  const checked = linkedSet.has(i.id);
                  return (
                    <label
                      key={i.id}
                      className="flex cursor-pointer items-center gap-2 border-b border-slate-100 px-2 py-1 text-sm last:border-b-0 hover:bg-slate-50"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleInitiative(i.id)}
                      />
                      <span className="truncate">{i.title}</span>
                    </label>
                  );
                })
              )}
            </div>
            <p className="mt-2 text-[11px] text-slate-500">
              Подзадачи показываются под parent-задачей автоматически — отдельно привязывать
              не нужно.
            </p>
          </section>

          <section className="flex items-center justify-end gap-2 border-t border-slate-200 pt-3">
            <button
              type="button"
              onClick={onDelete}
              className="inline-flex items-center gap-1 rounded-md border border-red-300 bg-red-50 px-3 py-1.5 text-sm text-red-700 hover:bg-red-100"
            >
              <Trash2 className="size-4" /> Удалить
            </button>
          </section>
        </div>
      </aside>
    </div>
  );
}
