"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { usePlanningStore } from "@/lib/planning-store";
import { ListView } from "@/components/list/ListView";

interface Props {
  initiativeId: string;
  excludeIds: Set<string>;
  open: boolean;
  onClose: () => void;
}

// Полная модалка для bulk-привязки задач к инициативе. Использует общий
// ListView в isolated + selectionMode режиме — UX идентичен разделу «Задачи»
// (фильтры, сорт, группировка, колонки), плюс чекбоксы и плавающая панель
// действий снизу. Изменения настроек ListView здесь НЕ влияют на основной
// раздел «Задачи» (isolated state).

export function TaskLinkPicker({ initiativeId, excludeIds, open, onClose }: Props) {
  const linkItems = usePlanningStore((s) => s.linkItemsToInitiative);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  if (!open) return null;

  const onToggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const onConfirm = async () => {
    if (selected.size === 0) return;
    setBusy(true);
    try {
      await linkItems(initiativeId, Array.from(selected));
      setSelected(new Set());
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="flex h-[85vh] w-full max-w-6xl flex-col rounded-lg bg-white shadow-xl">
        <header className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold">Привязать задачи к инициативе</h2>
            <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] tabular-nums text-slate-500">
              выбрано: {selected.size}
            </span>
          </div>
          <button onClick={onClose} className="rounded-md p-1 text-slate-400 hover:bg-slate-100">
            <X className="size-4" />
          </button>
        </header>

        <div className="min-h-0 flex-1">
          <ListView
            excludeIds={excludeIds}
            selectionMode={{ selected, onToggle }}
          />
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-slate-200 px-4 py-3">
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
        </footer>
      </div>
    </div>
  );
}
