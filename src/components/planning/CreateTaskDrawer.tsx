"use client";

import { useState } from "react";
import { usePlanningStore } from "@/lib/planning-store";

interface Props { open: boolean; onClose: () => void; }

export function CreateTaskDrawer({ open, onClose }: Props) {
  const [title, setTitle] = useState("");
  const [why, setWhy] = useState("");
  const createTask = usePlanningStore((s) => s.createTask);

  if (!open) return null;

  const submit = async () => {
    if (!title.trim()) return;
    await createTask({ title: title.trim(), why: why || undefined });
    setTitle(""); setWhy(""); onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="flex-1 bg-black/30" onClick={onClose} />
      <div className="flex w-[420px] flex-col gap-3 bg-white p-6 shadow-xl">
        <h2 className="text-lg font-semibold">Новая задача</h2>
        <label className="text-sm">
          Название
          <input value={title} onChange={(e) => setTitle(e.target.value)} className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
        </label>
        <label className="text-sm">
          Зачем (why)
          <textarea value={why} onChange={(e) => setWhy(e.target.value)} rows={3} className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
        </label>
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-md px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100">Отмена</button>
          <button onClick={submit} disabled={!title.trim()} className="rounded-md bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700 disabled:opacity-50">Создать</button>
        </div>
      </div>
    </div>
  );
}
