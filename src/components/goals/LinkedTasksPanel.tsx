"use client";

import { useEffect, useState } from "react";
import { useBrainStore } from "@/lib/store";
import type { RelationWithTarget, ItemWithSubtasks } from "@/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, X, CheckCircle2, Circle } from "lucide-react";
import { cn } from "@/lib/utils";

export function LinkedTasksPanel({ goalId }: { goalId: string }) {
  const items = useBrainStore((s) => s.items);
  const fetchRelations = useBrainStore((s) => s.fetchRelations);
  const linkTaskToGoal = useBrainStore((s) => s.linkTaskToGoal);
  const unlinkTaskFromGoal = useBrainStore((s) => s.unlinkTaskFromGoal);
  const openDetail = useBrainStore((s) => s.openDetail);

  const [linked, setLinked] = useState<RelationWithTarget[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [adding, setAdding] = useState(false);

  async function refresh() {
    setLoading(true);
    const rels = await fetchRelations("goal", goalId);
    setLinked(rels.filter((r) => r.target_type === "item"));
    setLoading(false);
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [goalId]);

  const linkedIds = new Set(linked.map((r) => r.target_id));
  const candidates: ItemWithSubtasks[] = !search.trim()
    ? []
    : items
        .filter((i) => !linkedIds.has(i.id))
        .filter((i) => i.title.toLowerCase().includes(search.toLowerCase()))
        .slice(0, 6);

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-[11px] font-semibold uppercase tracking-widest text-slate-500">
          Связанные задачи
        </h3>
        <span className="text-[10px] tabular-nums text-slate-400">{linked.length}</span>
      </div>

      <div className="space-y-1">
        {linked.map((r) => {
          const item = items.find((i) => i.id === r.target_id);
          const done = item?.status === "done";
          return (
            <div
              key={r.id}
              className="flex items-center gap-1.5 rounded border border-slate-100 bg-slate-50/50 px-2 py-1.5"
            >
              {done ? (
                <CheckCircle2 className="size-3.5 shrink-0 text-emerald-500" />
              ) : (
                <Circle className="size-3.5 shrink-0 text-slate-300" />
              )}
              <button
                onClick={() => item && openDetail(item.id)}
                className={cn(
                  "flex-1 truncate text-left text-xs hover:underline",
                  done && "text-slate-400 line-through",
                )}
              >
                {r.target_title || "(удалено)"}
              </button>
              <button
                onClick={async () => {
                  await unlinkTaskFromGoal(goalId, r.target_id);
                  await refresh();
                }}
                className="text-slate-300 hover:text-red-500"
                title="Отвязать"
              >
                <X className="size-3" />
              </button>
            </div>
          );
        })}
        {!linked.length && !loading && (
          <p className="rounded-lg border border-dashed border-slate-200 px-3 py-3 text-center text-xs text-slate-400">
            Привяжите задачи, чтобы их прогресс учитывался в KR «Задачи».
          </p>
        )}
      </div>

      {!adding ? (
        <Button
          size="sm"
          variant="outline"
          className="mt-2 w-full justify-center text-xs"
          onClick={() => setAdding(true)}
        >
          <Plus className="mr-1 size-3" /> Привязать задачу
        </Button>
      ) : (
        <div className="mt-2 rounded-md border border-slate-200 bg-white p-1.5">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Найти задачу…"
            className="h-7 text-xs"
            autoFocus
          />
          <div className="mt-1 max-h-40 overflow-y-auto">
            {candidates.map((c) => (
              <button
                key={c.id}
                onClick={async () => {
                  await linkTaskToGoal(goalId, c.id);
                  await refresh();
                  setSearch("");
                }}
                className="flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-left text-xs hover:bg-slate-100"
              >
                <span className="truncate">{c.title}</span>
              </button>
            ))}
            {search && !candidates.length && (
              <p className="px-1.5 py-1 text-[11px] text-slate-400">Ничего не найдено</p>
            )}
          </div>
          <div className="mt-1 flex justify-end">
            <Button
              size="sm"
              variant="ghost"
              className="h-6 text-[11px]"
              onClick={() => {
                setAdding(false);
                setSearch("");
              }}
            >
              Закрыть
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
