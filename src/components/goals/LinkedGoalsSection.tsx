"use client";

import { useEffect, useMemo, useState } from "react";
import { useBrainStore } from "@/lib/store";
import type { GoalFull, RelationWithTarget } from "@/types";
import { GOAL_LEVEL_CONFIG } from "@/types";
import { lookupAxis } from "@/lib/goal-axes";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, X, ChevronUp, ChevronDown, ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";

const LEVEL_RANK: Record<string, number> = { year: 0, quarter: 1, month: 2, week: 3, day: 4 };
const RELATION_TYPE_ID = "contributes_to_goal";

/**
 * "Эта цель → вкладывается в большую" / "В эту цель вкладываются меньшие".
 * Связи существуют независимо от parent_id и позволяют объединять прогресс
 * на разных временных горизонтах (например, годовая цель проекта собирает
 * вклады недельных задач из совершенно других ветвей).
 */
export function LinkedGoalsSection({ goal }: { goal: GoalFull }) {
  const goals = useBrainStore((s) => s.goals);
  const goalAxes = useBrainStore((s) => s.goalAxes);
  const fetchRelations = useBrainStore((s) => s.fetchRelations);
  const createRelation = useBrainStore((s) => s.createRelation);
  const deleteRelation = useBrainStore((s) => s.deleteRelation);

  const [rels, setRels] = useState<RelationWithTarget[]>([]);
  const [loading, setLoading] = useState(false);
  const [adding, setAdding] = useState<"contributes_to" | "contributed_by" | null>(null);
  const [search, setSearch] = useState("");

  async function refresh() {
    setLoading(true);
    const all = await fetchRelations("goal", goal.id);
    setRels(all.filter((r) => r.target_type === "goal" && r.relation_type?.id === RELATION_TYPE_ID));
    setLoading(false);
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [goal.id]);

  // contributes_to: rows where source = current (smaller→bigger). After flipping in db.ts,
  // rels are normalized so target is the "other" goal. We need actual direction back from raw fetch
  // — easier: compare levels.
  const contributesTo: RelationWithTarget[] = []; // current goal → bigger
  const contributedBy: RelationWithTarget[] = []; // smaller → current goal
  const myRank = LEVEL_RANK[goal.level] ?? 5;
  for (const r of rels) {
    const other = goals.find((g) => g.id === r.target_id);
    if (!other) continue;
    const otherRank = LEVEL_RANK[other.level] ?? 5;
    if (otherRank < myRank) contributesTo.push(r);
    else contributedBy.push(r);
  }

  const linkedIds = new Set(rels.map((r) => r.target_id));
  const candidates: GoalFull[] = useMemo(() => {
    if (!adding) return [];
    const isAddingBigger = adding === "contributes_to";
    return goals
      .filter((g) => g.id !== goal.id)
      .filter((g) => !linkedIds.has(g.id))
      .filter((g) => isAddingBigger ? (LEVEL_RANK[g.level] ?? 5) < myRank : (LEVEL_RANK[g.level] ?? 5) > myRank)
      .filter((g) => !search.trim() || g.title.toLowerCase().includes(search.toLowerCase()))
      .slice(0, 8);
  }, [goals, goal.id, linkedIds, adding, search, myRank]);

  async function addLink(targetGoalId: string) {
    // For "contributes_to_bigger": current(smaller) → target(bigger).
    // For "contributed_by_smaller": target(smaller) → current(bigger).
    if (adding === "contributes_to") {
      await createRelation("goal", goal.id, "goal", targetGoalId, RELATION_TYPE_ID);
    } else {
      await createRelation("goal", targetGoalId, "goal", goal.id, RELATION_TYPE_ID);
    }
    setAdding(null);
    setSearch("");
    await refresh();
  }

  async function removeLink(rel: RelationWithTarget) {
    await deleteRelation(rel.id);
    await refresh();
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-[11px] font-semibold uppercase tracking-widest text-slate-500">
          Связи с другими целями
        </h3>
      </div>

      {/* Этa цель → большая */}
      <div>
        <div className="mb-1 flex items-center justify-between text-[10px] uppercase tracking-wide text-slate-400">
          <span className="flex items-center gap-1">
            <ChevronUp className="size-3" /> Вкладывается в
          </span>
          <button
            onClick={() => setAdding(adding === "contributes_to" ? null : "contributes_to")}
            className="rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            title="Привязать к большей цели"
          >
            <Plus className="size-3" />
          </button>
        </div>
        {contributesTo.length === 0 && (
          <p className="text-[11px] text-slate-400">Не привязана к более крупной цели.</p>
        )}
        {contributesTo.map((r) => (
          <GoalLinkRow
            key={r.id}
            goal={goals.find((g) => g.id === r.target_id)}
            axesLookup={goalAxes}
            onRemove={() => removeLink(r)}
          />
        ))}
      </div>

      {/* Меньшие → эта */}
      <div>
        <div className="mb-1 flex items-center justify-between text-[10px] uppercase tracking-wide text-slate-400">
          <span className="flex items-center gap-1">
            <ChevronDown className="size-3" /> Вклад от
          </span>
          <button
            onClick={() => setAdding(adding === "contributed_by" ? null : "contributed_by")}
            className="rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            title="Привязать меньшую цель"
          >
            <Plus className="size-3" />
          </button>
        </div>
        {contributedBy.length === 0 && (
          <p className="text-[11px] text-slate-400">Меньшие цели сюда не подвязаны.</p>
        )}
        {contributedBy.map((r) => (
          <GoalLinkRow
            key={r.id}
            goal={goals.find((g) => g.id === r.target_id)}
            axesLookup={goalAxes}
            onRemove={() => removeLink(r)}
          />
        ))}
      </div>

      {adding && (
        <div className="rounded-md border border-violet-200 bg-violet-50/30 p-1.5">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={adding === "contributes_to" ? "Найти большую цель…" : "Найти меньшую цель…"}
            className="h-7 text-xs"
            autoFocus
          />
          <div className="mt-1 max-h-44 overflow-y-auto">
            {candidates.length === 0 && (
              <p className="px-1.5 py-1 text-[11px] text-slate-400">
                {search ? "Ничего не найдено" : "Введите часть названия для поиска"}
              </p>
            )}
            {candidates.map((c) => {
              const ax = lookupAxis(goalAxes, c.axis);
              return (
                <button
                  key={c.id}
                  onClick={() => addLink(c.id)}
                  className="flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-left text-xs hover:bg-white"
                >
                  <span
                    className="rounded px-1 py-px text-[9px] font-medium uppercase"
                    style={{ backgroundColor: ax?.bg ?? "#f1f5f9", color: ax?.color ?? "#64748b" }}
                  >
                    {GOAL_LEVEL_CONFIG[c.level].short}
                  </span>
                  <span className="truncate">{c.title}</span>
                  <ArrowRight className="ml-auto size-3 text-slate-300" />
                </button>
              );
            })}
          </div>
          <div className="mt-1 flex justify-end">
            <Button
              size="sm"
              variant="ghost"
              className="h-6 text-[11px]"
              onClick={() => {
                setAdding(null);
                setSearch("");
              }}
            >
              Закрыть
            </Button>
          </div>
        </div>
      )}
      {loading && <p className="text-[10px] text-slate-300">Загрузка…</p>}
    </div>
  );
}

function GoalLinkRow({
  goal,
  axesLookup,
  onRemove,
}: {
  goal: GoalFull | undefined;
  axesLookup: ReturnType<typeof useBrainStore.getState>["goalAxes"];
  onRemove: () => void;
}) {
  const selectGoal = useBrainStore((s) => s.selectGoal);
  if (!goal) {
    return (
      <div className="mb-1 flex items-center gap-1.5 rounded border border-slate-100 bg-slate-50/50 px-2 py-1.5 text-xs text-slate-400">
        (удалена)
      </div>
    );
  }
  const ax = lookupAxis(axesLookup, goal.axis);
  const pct = Math.round(goal.progress * 100);
  return (
    <div className="mb-1 flex items-center gap-1.5 rounded border border-slate-100 bg-slate-50/50 px-2 py-1.5">
      <span
        className="rounded px-1 py-px text-[9px] font-medium uppercase"
        style={{ backgroundColor: ax?.bg ?? "#f1f5f9", color: ax?.color ?? "#64748b" }}
      >
        {GOAL_LEVEL_CONFIG[goal.level].short}
      </span>
      <button
        onClick={() => selectGoal(goal.level, goal.id)}
        className={cn("flex-1 truncate text-left text-xs hover:underline")}
        title="Перейти к цели"
      >
        {goal.title}
      </button>
      <span className="w-8 text-right text-[10px] tabular-nums text-slate-500">{pct}%</span>
      <button
        onClick={onRemove}
        className="text-slate-300 hover:text-red-500"
        title="Отвязать"
      >
        <X className="size-3" />
      </button>
    </div>
  );
}
