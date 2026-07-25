"use client";

// Поиск по задачам и клиентам (⌘K / Ctrl+K). Видимость фильтрует сервер.

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { CheckCircle2, Search, Users } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { api } from "@/lib/core/client";
import { useV2Store } from "@/lib/core/ui-store";
import { cn } from "@/lib/utils";

interface SearchHit {
  type: "task" | "client" | "project";
  id: string;
  title: string;
  subtitle: string | null;
  completed: boolean;
}

export function GlobalSearch({
  open,
  onOpenChange,
  onPickTask,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPickTask: (taskId: string) => void;
}) {
  const router = useRouter();
  const { orgId } = useV2Store();
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [active, setActive] = useState(0);
  const seq = useRef(0);

  useEffect(() => {
    if (!open) {
      // Инкремент отменяет ответы в полёте: иначе они дорисуют результаты
      // прошлого запроса в уже очищенную палитру.
      seq.current++;
      setQuery("");
      setHits([]);
      setActive(0);
    }
  }, [open]);

  useEffect(() => {
    if (!orgId || query.trim().length < 2) {
      seq.current++;
      setHits([]);
      return;
    }
    const mine = ++seq.current;
    const t = setTimeout(async () => {
      try {
        const res = await api.get<SearchHit[]>(
          `/orgs/${orgId}/search?q=${encodeURIComponent(query.trim())}`,
        );
        if (seq.current === mine) {
          setHits(res);
          setActive(0);
        }
      } catch {
        if (seq.current === mine) setHits([]);
      }
    }, 200);
    return () => clearTimeout(t);
  }, [orgId, query]);

  function pick(hit: SearchHit) {
    onOpenChange(false);
    if (hit.type === "task") onPickTask(hit.id);
    else if (hit.type === "client") router.push(`/v2/clients?client=${hit.id}`);
    else router.push(`/v2/projects/${hit.id}`);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="top-24 translate-y-0 gap-0 overflow-hidden p-0 sm:max-w-xl"
      >
        <DialogTitle className="sr-only">Поиск</DialogTitle>
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <Search className="size-4 shrink-0 text-muted-foreground" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActive((a) => Math.min(a + 1, hits.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActive((a) => Math.max(a - 1, 0));
              } else if (e.key === "Enter" && hits[active]) {
                pick(hits[active]);
              }
            }}
            placeholder="Поиск задач и клиентов…"
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>
        <div className="max-h-80 overflow-y-auto p-1">
          {query.trim().length >= 2 && hits.length === 0 && (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">Ничего не найдено</p>
          )}
          {hits.map((h, i) => (
            <button
              key={`${h.type}-${h.id}`}
              onClick={() => pick(h)}
              onMouseEnter={() => setActive(i)}
              className={cn(
                "flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm",
                i === active && "bg-muted",
              )}
            >
              {h.type === "client" ? (
                <Users className="size-4 shrink-0 text-muted-foreground" />
              ) : (
                <CheckCircle2
                  className={cn("size-4 shrink-0", h.completed ? "text-emerald-500" : "text-muted-foreground")}
                />
              )}
              <span className="min-w-0 flex-1">
                <span className={cn("block truncate", h.completed && "text-muted-foreground line-through")}>
                  {h.title}
                </span>
                {h.subtitle && <span className="block truncate text-xs text-muted-foreground">{h.subtitle}</span>}
              </span>
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
