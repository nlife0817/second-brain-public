"use client";

import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { usePlanningStore } from "@/lib/planning-store";
import { MetricColumn } from "@/components/planning/MetricColumn";
import { InitiativeColumn } from "@/components/planning/InitiativeColumn";
import { TaskColumn } from "@/components/planning/TaskColumn";
import { InlineTextField } from "@/components/planning/InlineTextField";

export default function PlanningColumnsPage() {
  const fetchAll = usePlanningStore((s) => s.fetchAll);
  const directions = usePlanningStore((s) => s.directions);
  const selectedDirectionId = usePlanningStore((s) => s.selectedDirectionId);
  const setSelectedDirection = usePlanningStore((s) => s.setSelectedDirection);
  const createDirection = usePlanningStore((s) => s.createDirection);
  const updateDirection = usePlanningStore((s) => s.updateDirection);
  const loaded = usePlanningStore((s) => s.loaded);
  const [newName, setNewName] = useState("");

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const currentDir = directions.find((d) => d.id === selectedDirectionId);

  if (!loaded) {
    return <div className="flex h-full items-center justify-center text-sm text-slate-500">Загрузка…</div>;
  }

  return (
    <div className="flex h-[calc(100vh-3rem)]">
      {/* Direction sidebar */}
      <aside className="flex w-[200px] flex-col border-r border-slate-200 bg-slate-50">
        <div className="flex h-10 items-center justify-between border-b border-slate-200 px-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Направления</h3>
        </div>
        <div className="flex-1 overflow-y-auto p-2">
          {directions.map((d) => (
            <button
              key={d.id}
              onClick={() => setSelectedDirection(d.id)}
              className={`w-full rounded-md px-3 py-2 text-left text-sm transition-colors ${
                d.id === selectedDirectionId ? "bg-white font-medium shadow-sm" : "text-slate-700 hover:bg-white"
              }`}
            >
              {d.title}
            </button>
          ))}
          <div className="mt-2 flex gap-1 px-1">
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Новое направление"
              className="min-w-0 flex-1 rounded-md border border-slate-300 bg-white px-2 py-1 text-xs"
              onKeyDown={async (e) => {
                if (e.key === "Enter" && newName.trim()) {
                  await createDirection({ title: newName.trim() });
                  setNewName("");
                }
              }}
            />
            <button
              onClick={async () => {
                if (newName.trim()) {
                  await createDirection({ title: newName.trim() });
                  setNewName("");
                }
              }}
              className="rounded-md bg-blue-600 px-2 text-white hover:bg-blue-700"
            >
              <Plus className="size-3.5" />
            </button>
          </div>
        </div>
      </aside>

      {/* Year focus header + 3 columns */}
      <div className="flex flex-1 flex-col">
        {currentDir && (
          <div className="border-b border-slate-200 px-4 py-2">
            <p className="text-[11px] uppercase tracking-wide text-slate-500">Фокус года</p>
            <InlineTextField
              value={currentDir.year_focus ?? ""}
              onSave={(t) => updateDirection(currentDir.id, { year_focus: t })}
              placeholder="Одна фраза-фокус года…"
              className="text-sm"
            />
          </div>
        )}
        <div className="flex flex-1 overflow-x-auto">
          <MetricColumn />
          <InitiativeColumn />
          <TaskColumn />
        </div>
      </div>
    </div>
  );
}
