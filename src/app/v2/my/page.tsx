"use client";

// «Мои задачи»: назначенные мне + личный инбокс (задачи без проекта).

import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { TaskCard } from "@/components/v2/TaskCard";
import { TaskSheet } from "@/components/v2/TaskSheet";
import { api } from "@/lib/core/client";
import type { TaskWithMeta } from "@/lib/core/types";
import { useV2Store } from "@/lib/core/ui-store";

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function MyTasksPage() {
  const { orgId, refreshProjects } = useV2Store();
  // Push-уведомление ведёт на /v2/my?task=<id> — открываем карточку сразу.
  const deepLinkTaskId = useSearchParams().get("task");
  const [tasks, setTasks] = useState<TaskWithMeta[]>([]);
  const [showDone, setShowDone] = useState(false);
  const [quickTitle, setQuickTitle] = useState("");
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!orgId) return;
    try {
      setTasks(await api.get<TaskWithMeta[]>(`/orgs/${orgId}/tasks${showDone ? "?done=1" : ""}`));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось загрузить задачи");
    } finally {
      setLoading(false);
    }
  }, [orgId, showDone]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (deepLinkTaskId) setOpenTaskId(deepLinkTaskId);
  }, [deepLinkTaskId]);

  async function quickAdd() {
    if (!orgId || !quickTitle.trim()) return;
    try {
      await api.post(`/orgs/${orgId}/tasks`, { title: quickTitle.trim() });
      setQuickTitle("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось создать задачу");
    }
  }

  const groups = useMemo(() => {
    const today = todayIso();
    const overdue: TaskWithMeta[] = [];
    const dueToday: TaskWithMeta[] = [];
    const upcoming: TaskWithMeta[] = [];
    const noDate: TaskWithMeta[] = [];
    const done: TaskWithMeta[] = [];
    for (const t of tasks) {
      if (t.completed_at) done.push(t);
      else if (!t.due_date) noDate.push(t);
      else if (t.due_date < today) overdue.push(t);
      else if (t.due_date === today) dueToday.push(t);
      else upcoming.push(t);
    }
    return [
      { key: "overdue", title: "Просрочено", items: overdue, tone: "text-red-600 dark:text-red-400" },
      { key: "today", title: "Сегодня", items: dueToday, tone: "text-amber-600 dark:text-amber-400" },
      { key: "upcoming", title: "Предстоящие", items: upcoming, tone: "" },
      { key: "nodate", title: "Без срока", items: noDate, tone: "" },
      ...(showDone ? [{ key: "done", title: "Завершённые", items: done, tone: "text-muted-foreground" }] : []),
    ].filter((g) => g.items.length > 0);
  }, [tasks, showDone]);

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-3 border-b border-border px-6 py-3.5">
        <h1 className="text-base font-semibold">Мои задачи</h1>
        <span className="flex-1" />
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={showDone}
            onChange={(e) => setShowDone(e.target.checked)}
            className="size-3.5 accent-primary"
          />
          Показывать завершённые
        </label>
      </header>

      <div className="flex-1 overflow-y-auto px-6 py-4">
        <div className="mx-auto flex max-w-3xl flex-col gap-5">
          <div className="flex items-center gap-2 rounded-lg border border-dashed border-border px-3 py-2">
            <Plus className="size-4 text-muted-foreground" />
            <input
              value={quickTitle}
              onChange={(e) => setQuickTitle(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void quickAdd()}
              placeholder="Быстро добавить задачу в личный инбокс…"
              className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
          </div>

          {error && <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
          {loading && <p className="text-sm text-muted-foreground">Загрузка…</p>}
          {!loading && groups.length === 0 && (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Пусто. Добавьте задачу или дождитесь назначения.
            </p>
          )}

          {groups.map((g) => (
            <section key={g.key}>
              <h2 className={`mb-2 text-xs font-semibold uppercase tracking-wide ${g.tone || "text-muted-foreground"}`}>
                {g.title} · {g.items.length}
              </h2>
              <div className="flex flex-col gap-1.5">
                {g.items.map((t) => (
                  <TaskCard key={t.id} task={t} onClick={() => setOpenTaskId(t.id)} />
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>

      <TaskSheet
        taskId={openTaskId}
        onClose={() => setOpenTaskId(null)}
        onChanged={() => {
          void load();
          void refreshProjects();
        }}
      />
    </div>
  );
}
