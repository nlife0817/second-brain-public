"use client";

// Список проектов организации: вход в мобильный просмотр досок.

import Link from "next/link";
import { useState } from "react";
import { ChevronRight, Plus } from "lucide-react";
import { CreateProjectDialog } from "@/components/v2/CreateProjectDialog";
import { useV2Store } from "@/lib/core/ui-store";

export default function MobileProjectsPage() {
  const { projects, metaLoading, orgRole } = useV2Store();
  const [createOpen, setCreateOpen] = useState(false);
  const isGuest = orgRole === "guest";

  return (
    <div className="flex h-full flex-col">
      <header className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-3">
        <h1 className="flex-1 text-base font-semibold">Проекты</h1>
        {!isGuest && (
          <button
            onClick={() => setCreateOpen(true)}
            className="rounded-lg p-1.5 text-muted-foreground"
            aria-label="Новый проект"
          >
            <Plus className="size-5" />
          </button>
        )}
      </header>

      <div className="flex-1 overflow-y-auto overscroll-contain px-2 py-2">
        {projects.map((p) => (
          <Link
            key={p.id}
            href={`/v2/m/projects/${p.id}`}
            className="flex items-center gap-3 rounded-xl px-3 py-3 active:bg-muted/60"
          >
            <span className="size-3 shrink-0 rounded" style={{ backgroundColor: p.color }} />
            <span className="min-w-0 flex-1 truncate text-sm font-medium">{p.name}</span>
            {p.open_task_count > 0 && (
              <span className="text-xs tabular-nums text-muted-foreground">{p.open_task_count}</span>
            )}
            <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
          </Link>
        ))}
        {projects.length === 0 && metaLoading && (
          <div className="flex flex-col gap-2 px-3 py-3" aria-hidden>
            {[0, 1, 2].map((i) => (
              <span key={i} className="h-5 animate-pulse rounded bg-muted" />
            ))}
          </div>
        )}
        {projects.length === 0 && !metaLoading && (
          <p className="px-3 py-10 text-center text-sm text-muted-foreground">
            {isGuest ? "Вам ещё не открыли ни одного проекта" : "Пока нет проектов"}
          </p>
        )}
      </div>

      <CreateProjectDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  );
}
