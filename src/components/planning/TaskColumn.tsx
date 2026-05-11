"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { usePlanningStore } from "@/lib/planning-store";
import { TaskCard } from "./TaskCard";
import { CreateTaskDrawer } from "./CreateTaskDrawer";

export function TaskColumn() {
  const initiativeId = usePlanningStore((s) => s.selectedInitiativeId);
  const tasks = usePlanningStore((s) => s.tasks).filter((t) =>
    initiativeId ? t.initiative_id === initiativeId : !t.initiative_id
  );
  const [open, setOpen] = useState(false);

  return (
    <div className="flex h-full w-[400px] flex-col">
      <div className="flex h-10 items-center justify-between border-b border-slate-200 px-3">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          {initiativeId ? "Задачи инициативы" : "Задачи без инициативы"}
        </h3>
        <button
          onClick={() => setOpen(true)}
          className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          title="Добавить задачу"
        >
          <Plus className="size-4" />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-2">
        {tasks.length === 0 ? (
          <div className="mt-8 text-center text-sm text-slate-500">
            <p>{initiativeId ? "Задач по инициативе нет." : "Сначала выберите инициативу."}</p>
            {initiativeId && (
              <button onClick={() => setOpen(true)} className="mt-3 rounded-md bg-blue-600 px-3 py-1.5 text-xs text-white hover:bg-blue-700">
                Создать задачу
              </button>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {tasks.map((t) => <TaskCard key={t.id} task={t} />)}
          </div>
        )}
      </div>
      <CreateTaskDrawer open={open} onClose={() => setOpen(false)} />
    </div>
  );
}
