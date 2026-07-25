"use client";

// «Мои задачи», мобильный экран: те же данные и группировка, что на десктопе
// (/v2/my), но раскладка под палец. Push-диплинк ?task= открывает карточку.

import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Eye, EyeOff, Plus } from "lucide-react";
import { TaskCard } from "@/components/v2/TaskCard";
import { TaskSheet } from "@/components/v2/TaskSheet";
import { api } from "@/lib/core/client";
import type { TaskListItem } from "@/lib/core/types";
import { useV2Store } from "@/lib/core/ui-store";
import { cn } from "@/lib/utils";

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function MobileMyTasksPage() {
  const { orgId, refreshProjects } = useV2Store();
  const deepLinkTaskId = useSearchParams().get("task");
  const [tasks, setTasks] = useState<TaskListItem[]>([]);
  const [showDone, setShowDone] = useState(false);
  const [quickTitle, setQuickTitle] = useState("");
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!orgId) return;
    try {
      setTasks(await api.get<TaskListItem[]>(`/orgs/${orgId}/tasks${showDone ? "?done=1" : ""}`));
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

  const openTask = useCallback((id: string) => setOpenTaskId(id), []);

  const groups = useMemo(() => {
    const today = todayIso();
    const overdue: TaskListItem[] = [];
    const dueToday: TaskListItem[] = [];
    const upcoming: TaskListItem[] = [];
    const noDate: TaskListItem[] = [];
    const done: TaskListItem[] = [];
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
      <header className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-3">
        <h1 className="flex-1 text-base font-semibold">Мои задачи</h1>
        <button
          onClick={() => setShowDone((v) => !v)}
          className={cn(
            "flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs",
            showDone ? "bg-muted text-foreground" : "text-muted-foreground",
          )}
        >
          {showDone ? <Eye className="size-4" /> : <EyeOff className="size-4" />}
          Готовые
        </button>
      </header>

      <div className="flex-1 overflow-y-auto overscroll-contain px-4 py-3">
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-2 rounded-xl border border-dashed border-border px-3 py-2.5">
            <Plus className="size-4 shrink-0 text-muted-foreground" />
            <input
              value={quickTitle}
              onChange={(e) => setQuickTitle(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void quickAdd()}
              enterKeyHint="done"
              placeholder="Быстро добавить задачу…"
              className="min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground"
            />
          </div>

          {error && <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
          {loading && <p className="text-sm text-muted-foreground">Загрузка…</p>}
          {!loading && groups.length === 0 && (
            <p className="py-10 text-center text-sm text-muted-foreground">
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
                  <TaskCard key={t.id} task={t} onOpen={openTask} />
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
