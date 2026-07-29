"use client";

// Связи карточки: задача ↔ задача, задача ↔ клиент, задача ↔ проект.
// Поиск целей идёт через обычный поиск, поэтому в подсказках заведомо нет
// объектов, которых пользователь не вправе видеть.

import { useCallback, useEffect, useState } from "react";
import { ArrowDownLeft, ArrowUpRight, Link2, Loader2, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { api } from "@/lib/core/client";
import type { RelationEntityType, RelationType, RelationWithTarget } from "@/lib/core/types";
import { useV2Store } from "@/lib/core/ui-store";
import { cn } from "@/lib/utils";

/** Форма ответа /search — см. SearchHit в lib/core/search.ts. */
interface SearchHit {
  type: RelationEntityType;
  id: string;
  title: string;
  subtitle: string | null;
  completed: boolean;
}

const ENTITY_LABELS: Record<RelationEntityType, string> = {
  task: "Задача",
  client: "Клиент",
  project: "Проект",
};

export function RelationsList({
  entityType,
  entityId,
  canEdit,
  initialRelations,
  initialTypes,
}: {
  entityType: RelationEntityType;
  entityId: string;
  canEdit: boolean;
  /**
   * Связи и справочник типов, уже загруженные родителем. Карточка задачи берёт
   * их из общего ответа `/tasks/:id/bundle`, поэтому свои два запроса здесь не
   * нужны. Когда пропсы не переданы (другие места использования) — грузим сами.
   */
  initialRelations?: RelationWithTarget[];
  initialTypes?: RelationType[];
}) {
  const orgId = useV2Store((s) => s.orgId);
  const [relations, setRelations] = useState<RelationWithTarget[]>(initialRelations ?? []);
  const [types, setTypes] = useState<RelationType[]>(initialTypes ?? []);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [typeId, setTypeId] = useState<string>("");

  const provided = initialRelations !== undefined && initialTypes !== undefined;

  const load = useCallback(async () => {
    if (!orgId) return;
    try {
      const [rels, relTypes] = await Promise.all([
        api.get<RelationWithTarget[]>(
          `/orgs/${orgId}/relations?entity_type=${entityType}&entity_id=${entityId}`,
        ),
        api.get<RelationType[]>(`/orgs/${orgId}/relation-types`),
      ]);
      setRelations(rels);
      setTypes(relTypes);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось загрузить связи");
    }
  }, [orgId, entityType, entityId]);

  // Родитель прислал данные — переносим их в состояние при смене сущности.
  useEffect(() => {
    if (!provided) return;
    setRelations(initialRelations ?? []);
    setTypes(initialTypes ?? []);
  }, [provided, initialRelations, initialTypes]);

  useEffect(() => {
    if (provided) return;
    void load();
  }, [provided, load]);

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
        const found = await api.get<SearchHit[]>(
          `/orgs/${orgId}/search?q=${encodeURIComponent(needle)}`,
        );
        if (!cancelled) setHits(found.filter((h) => h.id !== entityId));
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
  }, [query, orgId, entityId]);

  async function link(hit: SearchHit) {
    if (!orgId) return;
    try {
      const next = await api.post<RelationWithTarget[]>(`/orgs/${orgId}/relations`, {
        source_type: entityType,
        source_id: entityId,
        target_type: hit.type,
        target_id: hit.id,
        relation_type_id: typeId || null,
      });
      setRelations(next);
      setQuery("");
      setHits([]);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось создать связь");
    }
  }

  async function unlink(relationId: string) {
    if (!orgId) return;
    const previous = relations;
    setRelations((prev) => prev.filter((r) => r.id !== relationId));
    try {
      await api.del(`/orgs/${orgId}/relations/${relationId}`);
    } catch (e) {
      setRelations(previous);
      setError(e instanceof Error ? e.message : "Не удалось удалить связь");
    }
  }

  return (
    <div>
      <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Связи</p>

      {error && <p className="mb-1.5 text-xs text-destructive">{error}</p>}

      <div className="flex flex-col gap-1">
        {relations.map((r) => {
          const type = types.find((t) => t.id === r.relation_type_id);
          return (
            <div key={r.id} className="group flex items-center gap-2 rounded-md px-1 py-0.5 hover:bg-muted/50">
              {r.direction === "outgoing" ? (
                <ArrowUpRight className="size-3.5 shrink-0 text-muted-foreground" />
              ) : (
                <ArrowDownLeft className="size-3.5 shrink-0 text-muted-foreground" />
              )}
              <span
                className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium"
                style={
                  type
                    ? { backgroundColor: `${type.color}1a`, color: type.color }
                    : { backgroundColor: "var(--muted)" }
                }
              >
                {type?.name ?? ENTITY_LABELS[r.entity_type]}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm" title={r.title}>
                {r.title}
              </span>
              {canEdit && (
                <button
                  onClick={() => void unlink(r.id)}
                  className="shrink-0 rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:text-destructive focus-visible:opacity-100 group-hover:opacity-100"
                  title="Убрать связь"
                >
                  <X className="size-3.5" />
                </button>
              )}
            </div>
          );
        })}
        {relations.length === 0 && <p className="px-1 text-xs text-muted-foreground">Связей пока нет</p>}
      </div>

      {canEdit && (
        <Popover>
          <PopoverTrigger
            render={
              <Button variant="ghost" size="xs" className="mt-1 gap-1 text-muted-foreground" />
            }
          >
            <Plus className="size-3" /> Связать
          </PopoverTrigger>
          <PopoverContent align="start" className="w-72 gap-2 p-2.5">
            {types.length > 0 && (
              <select
                value={typeId}
                onChange={(e) => setTypeId(e.target.value)}
                className="h-7 rounded-lg border border-input bg-background px-1.5 text-xs outline-none focus-visible:border-ring"
              >
                <option value="">Без типа связи</option>
                {types.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            )}
            <div className="relative">
              <Link2 className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Найти задачу, клиента, проект…"
                className="h-8 w-full rounded-lg border border-input bg-transparent pl-7 pr-7 text-sm outline-none focus-visible:border-ring"
              />
              {searching && (
                <Loader2 className="absolute right-2 top-1/2 size-3.5 -translate-y-1/2 animate-spin text-muted-foreground" />
              )}
            </div>
            <div className="flex max-h-56 flex-col overflow-y-auto">
              {hits.map((hit) => (
                <button
                  key={`${hit.type}:${hit.id}`}
                  onClick={() => void link(hit)}
                  className="flex items-center gap-2 rounded px-1.5 py-1 text-left text-sm hover:bg-muted"
                >
                  <span className="shrink-0 rounded bg-muted px-1 text-[10px] text-muted-foreground">
                    {ENTITY_LABELS[hit.type]}
                  </span>
                  <span
                    className={cn("min-w-0 flex-1 truncate", hit.completed && "text-muted-foreground line-through")}
                  >
                    {hit.title}
                  </span>
                  {hit.subtitle && (
                    <span className="shrink-0 text-[10px] text-muted-foreground">{hit.subtitle}</span>
                  )}
                </button>
              ))}
              {query.trim().length >= 2 && !searching && hits.length === 0 && (
                <p className="px-1.5 py-1 text-xs text-muted-foreground">Ничего не нашлось</p>
              )}
              {query.trim().length < 2 && (
                <p className={cn("px-1.5 py-1 text-xs text-muted-foreground")}>
                  Введите минимум два символа
                </p>
              )}
            </div>
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}
