"use client";

import type { Item } from "@/types";
import { InlineTextField } from "./InlineTextField";
import { usePlanningStore } from "@/lib/planning-store";

interface Props { task: Item; }

export function TaskCard({ task }: Props) {
  const updateTask = usePlanningStore((s) => s.updateTask);
  const isDone = task.status === "done";
  return (
    <div className="rounded-lg border border-slate-200 p-3 hover:bg-slate-50">
      <div className="flex items-start gap-2">
        <input
          type="checkbox"
          checked={isDone}
          onChange={(e) => updateTask(task.id, { status: e.target.checked ? "done" : "todo" })}
          className="mt-1 size-3.5 rounded border-slate-300"
        />
        <div className="flex-1">
          <InlineTextField
            value={task.title}
            onSave={(t) => updateTask(task.id, { title: t })}
            className={`text-sm ${isDone ? "text-slate-400 line-through" : "font-medium"}`}
          />
          {task.why ? (
            <p className="px-2 text-xs text-slate-500 line-clamp-2" title={task.why ?? undefined}>
              {task.why.length > 80 ? `${task.why.slice(0, 80)}…` : task.why}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
