"use client";

// Выбор задачи для связывания в иерархию: «сделать подзадачей», «выбрать
// родителя», массовое переподчинение из таблицы.
//
// Кандидатов даёт обычный поиск, поэтому в подсказках заведомо нет задач,
// которых пользователь не вправе видеть. Права на *правку* поиск при этом не
// проверяет — их проверит сервер при сохранении: подзадача наследует доступ по
// цепочке, и родителя можно назначить только там, где есть право править.

import { useEffect, useState } from "react";
import { CornerLeftUp, Loader2, Search } from "lucide-react";
import { api } from "@/lib/core/client";
import { useV2Store } from "@/lib/core/ui-store";
import { cn } from "@/lib/utils";

/** Форма ответа /search — см. SearchHit в lib/core/search.ts. */
export interface TaskHit {
  type: "task" | "client" | "project";
  id: string;
  title: string;
  subtitle: string | null;
  completed: boolean;
  has_parent: boolean;
}

/**
 * Поле поиска со списком найденных задач. Клиенты и проекты отсеиваются: в
 * иерархию задач им дороги нет.
 *
 * `excludeIds` убирает заведомо негодных кандидатов — саму задачу и её
 * подзадачи. Полную ветку здесь не считаем: обход дерева ради подсказок стоил
 * бы запроса на каждый символ, а кольцо всё равно ловит сервер и отвечает
 * внятным отказом.
 */
export function TaskSearchField({
  excludeIds = [],
  placeholder = "Найти задачу по названию…",
  emptyHint = "Введите минимум два символа",
  onPick,
}: {
  excludeIds?: string[];
  placeholder?: string;
  emptyHint?: string;
  /** Ошибку показывает вызывающий: она относится к его действию, а не к поиску. */
  onPick: (hit: TaskHit) => void | Promise<void>;
}) {
  const orgId = useV2Store((s) => s.orgId);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<TaskHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [busy, setBusy] = useState(false);

  // Поиск с задержкой: строка меняется на каждый символ, а запрос нужен один.
  useEffect(() => {
    const needle = query.trim();
    if (!orgId || needle.length < 2) {
      setHits([]);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const timer = setTimeout(async () => {
      try {
        const found = await api.get<TaskHit[]>(
          `/orgs/${orgId}/search?q=${encodeURIComponent(needle)}`,
        );
        if (!cancelled) setHits(found.filter((h) => h.type === "task"));
      } catch {
        if (!cancelled) setHits([]);
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, orgId]);

  const excluded = new Set(excludeIds);
  const shown = hits.filter((h) => !excluded.has(h.id));

  async function pick(hit: TaskHit) {
    if (busy) return;
    setBusy(true);
    try {
      await onPick(hit);
      setQuery("");
      setHits([]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={placeholder}
          className="h-8 w-full rounded-lg border border-input bg-transparent pl-7 pr-7 text-sm outline-none focus-visible:border-ring"
        />
        {(searching || busy) && (
          <Loader2 className="absolute right-2 top-1/2 size-3.5 -translate-y-1/2 animate-spin text-muted-foreground" />
        )}
      </div>
      <div className="flex max-h-56 flex-col overflow-y-auto">
        {shown.map((hit) => (
          <button
            key={hit.id}
            onClick={() => void pick(hit)}
            disabled={busy}
            className="flex items-center gap-2 rounded px-1.5 py-1 text-left text-sm hover:bg-muted disabled:opacity-60"
          >
            <span
              className={cn(
                "min-w-0 flex-1 truncate",
                hit.completed && "text-muted-foreground line-through",
              )}
            >
              {hit.title}
            </span>
            {/* Задача уже чья-то подзадача: привязка разорвёт прежнюю связь, и
                знать об этом надо до клика, а не из окна подтверждения. */}
            {hit.has_parent && (
              <CornerLeftUp
                className="size-3 shrink-0 text-muted-foreground"
                aria-label="Уже подзадача"
              />
            )}
            {hit.subtitle && (
              <span className="max-w-24 shrink-0 truncate text-[10px] text-muted-foreground">
                {hit.subtitle}
              </span>
            )}
          </button>
        ))}
        {query.trim().length >= 2 && !searching && shown.length === 0 && (
          <p className="px-1.5 py-1 text-xs text-muted-foreground">Ничего не нашлось</p>
        )}
        {query.trim().length < 2 && (
          <p className="px-1.5 py-1 text-xs text-muted-foreground">{emptyHint}</p>
        )}
      </div>
    </div>
  );
}
