"use client";

// Строка создания задачи в виде «Бэклог» — своя в бэклоге и в каждом открытом
// спринте, поэтому набранное на планёрке пишется сразу туда, где ему место, а
// не через бэклог и перетаскивание.
//
// По возможностям это та же строка, что в таблице: черновик со всеми полями и
// «развернуть» в панель справа. Раскладка другая — колонок в бэклоге нет
// (ровно та же причина, что у подзадач в карточке), поэтому редакторы полей
// собраны в компактные чипы над теми же меню (`draft-chips`).

import { useCallback, useEffect, useRef, useState } from "react";
import { Maximize2, Plus, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { emptyDraft, isDraftFilled, type TaskDraft } from "@/lib/core/task-draft";
import type { TaskStatus } from "@/lib/core/types";
import {
  AssigneesChip,
  DueChip,
  EstimateChip,
  PriorityChip,
  StatusChip,
} from "./draft-chips";
import { TaskDraftPanel } from "./TaskDraftPanel";

export function BacklogComposer({
  defaults,
  statuses,
  placeholder,
  onCreate,
}: {
  /** Что экран проставляет в черновик: свой проект и пустой срок. */
  defaults: Partial<TaskDraft>;
  /** Статусы набора проекта: новая задача рождается в его процессе, а не в чужом. */
  statuses: TaskStatus[];
  placeholder: string;
  onCreate: (draft: TaskDraft) => Promise<void>;
}) {
  const [draft, setDraft] = useState<TaskDraft>(() => emptyDraft(defaults));
  const [expanded, setExpanded] = useState(false);
  // Панель монтируется только после первого разворачивания: композеров на
  // экране столько, сколько спринтов, а внутри панели живёт редактор описания.
  const [panelMounted, setPanelMounted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const titleRef = useRef<HTMLInputElement>(null);

  // Описание в развёрнутой панели отдаётся по blur: клик по «Добавить» сначала
  // снимает фокус с редактора, и обработчик клика видел бы черновик прошлого
  // рендера. Ref обновляется после коммита — к моменту клика он уже свежий.
  const draftRef = useRef(draft);
  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  const patch = useCallback((change: Partial<TaskDraft>) => {
    setDraft((prev) => ({ ...prev, ...change }));
  }, []);

  const reset = useCallback(() => {
    setDraft(emptyDraft(defaults));
    setError(null);
  }, [defaults]);

  const save = useCallback(async () => {
    const current = draftRef.current;
    if (!current.title.trim() || saving) return;
    setSaving(true);
    try {
      await onCreate(current);
      setDraft(emptyDraft(defaults));
      setExpanded(false);
      setError(null);
      // Фокус остаётся в поле: задачи на планировании заводят пачками.
      titleRef.current?.focus();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось создать задачу");
    } finally {
      setSaving(false);
    }
  }, [onCreate, saving, defaults]);

  const filled = isDraftFilled(draft, defaults);

  return (
    <>
      {/* flex-wrap: в узкой колонке чипы уезжают на вторую строку, а не
          сжимают поле названия до нечитаемой ширины. */}
      <div className="flex flex-wrap items-center gap-0.5 border-t border-border/60 px-2 py-1">
        <Plus className="size-3.5 shrink-0 text-muted-foreground" />
        <input
          ref={titleRef}
          value={draft.title}
          onChange={(e) => patch({ title: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void save();
            }
            if (e.key === "Escape") {
              e.preventDefault();
              reset();
            }
          }}
          placeholder={placeholder}
          className="h-7 min-w-32 flex-1 bg-transparent px-1 text-xs outline-none placeholder:text-muted-foreground/70"
        />
        <PriorityChip value={draft.priority} onChange={(priority) => patch({ priority })} />
        <StatusChip
          value={draft.status_id}
          statuses={statuses}
          onChange={(status_id) => patch({ status_id })}
        />
        <AssigneesChip
          value={draft.assignee_ids}
          projectIds={draft.project_ids}
          onChange={(assignee_ids) => patch({ assignee_ids })}
        />
        <DueChip date={draft.due_date} time={draft.due_time} onChange={(next) => patch(next)} />
        <EstimateChip
          value={draft.estimated_minutes}
          onChange={(estimated_minutes) => patch({ estimated_minutes })}
        />
        <Button
          variant="ghost"
          size="xs"
          onClick={() => {
            setPanelMounted(true);
            setExpanded(true);
          }}
          title="Развернуть черновик: описание, теги, проекты, доп. поля"
        >
          <Maximize2 className="size-3" />
        </Button>
      </div>

      {(filled || error) && (
        <div className="flex flex-wrap items-center gap-1.5 border-t border-border/60 px-2 py-1.5">
          <Button size="xs" onClick={() => void save()} disabled={saving || !draft.title.trim()}>
            {saving ? "Сохранение…" : "Добавить"}
          </Button>
          {filled && (
            <Button variant="ghost" size="xs" className="gap-1" onClick={reset} disabled={saving}>
              <RotateCcw className="size-3" />
              Очистить
            </Button>
          )}
          {error && <span className="truncate text-xs text-destructive">{error}</span>}
        </div>
      )}

      {panelMounted && (
        <TaskDraftPanel
          open={expanded}
          draft={draft}
          onChange={patch}
          onCollapse={() => setExpanded(false)}
          onCancel={() => {
            reset();
            setExpanded(false);
          }}
          onSave={() => void save()}
          saving={saving}
          error={error}
        />
      )}
    </>
  );
}
