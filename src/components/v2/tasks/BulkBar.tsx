"use client";

// Панель массовых действий: появляется, когда выбраны строки. Серверного
// bulk-эндпоинта нет — страница шлёт обычные PATCH пачками с ограниченной
// параллельностью, поэтому здесь только выбор значения и подтверждение.

import { useState } from "react";
import { Check, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { PRIORITY_LABELS } from "@/components/v2/bits";
import type { CoreTag, OrgMemberWithUser, TaskPriority, TaskStatus } from "@/lib/core/types";
import { cn } from "@/lib/utils";

export interface BulkBarProps {
  count: number;
  statuses: TaskStatus[];
  tags: CoreTag[];
  /** Уже суженный список: закрытые проекты выбранных задач его ограничивают. */
  members: OrgMemberWithUser[];
  /** Названия закрытых проектов, сузивших список исполнителей. */
  restrictedBy?: string[];
  busy: boolean;
  onClear: () => void;
  onApply: (payload: Record<string, unknown>) => void;
  onAddTag: (tagId: string) => void;
  onRemoveTag: (tagId: string) => void;
  onDelete: () => void;
}

const ITEM = "flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted";

export function BulkBar({
  count,
  statuses,
  tags,
  members,
  restrictedBy = [],
  busy,
  onClear,
  onApply,
  onAddTag,
  onRemoveTag,
  onDelete,
}: BulkBarProps) {
  const [confirmDelete, setConfirmDelete] = useState(false);

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-t border-border bg-muted/40 px-4 py-2">
      <span className="text-xs font-medium tabular-nums">
        Выбрано: {count}
        {busy && " · применяю…"}
      </span>

      <Popover>
        <PopoverTrigger render={<Button variant="outline" size="xs" disabled={busy} />}>Статус</PopoverTrigger>
        <PopoverContent align="start" className="max-h-72 w-56 overflow-y-auto p-1">
          {statuses.map((s) => (
            <button key={s.id} onClick={() => onApply({ status_id: s.id })} className={ITEM}>
              <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: s.color }} />
              <span className="flex-1 truncate text-left">{s.name}</span>
            </button>
          ))}
        </PopoverContent>
      </Popover>

      <Popover>
        <PopoverTrigger render={<Button variant="outline" size="xs" disabled={busy} />}>Приоритет</PopoverTrigger>
        <PopoverContent align="start" className="w-48 p-1">
          {(Object.keys(PRIORITY_LABELS) as TaskPriority[]).map((p) => (
            <button key={p} onClick={() => onApply({ priority: p })} className={ITEM}>
              <span className={cn("size-2 shrink-0 rounded-full", PRIORITY_LABELS[p].dot)} />
              <span className="flex-1 text-left">{PRIORITY_LABELS[p].label}</span>
            </button>
          ))}
        </PopoverContent>
      </Popover>

      <Popover>
        <PopoverTrigger render={<Button variant="outline" size="xs" disabled={busy} />}>Исполнитель</PopoverTrigger>
        <PopoverContent align="start" className="max-h-72 w-60 overflow-y-auto p-1">
          <button onClick={() => onApply({ assignee_ids: [] })} className={cn(ITEM, "text-muted-foreground")}>
            <X className="size-3.5" /> Снять исполнителей
          </button>
          {members.map((m) => (
            <button key={m.user_id} onClick={() => onApply({ assignee_ids: [m.user_id] })} className={ITEM}>
              <span className="flex-1 truncate text-left">{m.name || m.email}</span>
            </button>
          ))}
          {restrictedBy.length > 0 && (
            <p className="mt-1 border-t border-border px-2 pt-1.5 text-[11px] leading-4 text-muted-foreground">
              Только участники закрытого проекта «{restrictedBy.join("», «")}»
            </p>
          )}
        </PopoverContent>
      </Popover>

      <Popover>
        <PopoverTrigger render={<Button variant="outline" size="xs" disabled={busy} />}>Теги</PopoverTrigger>
        <PopoverContent align="start" className="max-h-72 w-60 overflow-y-auto p-1">
          <p className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Добавить
          </p>
          {tags.map((t) => (
            <button key={`add-${t.id}`} onClick={() => onAddTag(t.id)} className={ITEM}>
              <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: t.color }} />
              <span className="flex-1 truncate text-left">{t.name}</span>
            </button>
          ))}
          <p className="mt-1 border-t border-border px-2 pt-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Убрать
          </p>
          {tags.map((t) => (
            <button
              key={`del-${t.id}`}
              onClick={() => onRemoveTag(t.id)}
              className={cn(ITEM, "text-muted-foreground")}
            >
              <X className="size-3.5 shrink-0" />
              <span className="flex-1 truncate text-left">{t.name}</span>
            </button>
          ))}
        </PopoverContent>
      </Popover>

      <Popover>
        <PopoverTrigger render={<Button variant="outline" size="xs" disabled={busy} />}>Срок</PopoverTrigger>
        <PopoverContent align="start" className="w-56 gap-2 p-2.5">
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Дата
            <input
              type="date"
              onChange={(e) => e.target.value && onApply({ due_date: e.target.value })}
              className="h-8 rounded-lg border border-input bg-transparent px-2 text-sm text-foreground outline-none focus-visible:border-ring"
            />
          </label>
          <button
            onClick={() => onApply({ due_date: null, due_time: null })}
            className="flex items-center gap-1.5 rounded px-1 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="size-3.5" /> Убрать срок
          </button>
        </PopoverContent>
      </Popover>

      <span className="flex-1" />

      {confirmDelete ? (
        <>
          <span className="text-xs text-destructive">Удалить {count} задач безвозвратно?</span>
          <Button
            variant="destructive"
            size="xs"
            disabled={busy}
            onClick={() => {
              setConfirmDelete(false);
              onDelete();
            }}
          >
            <Check className="size-3" /> Да, удалить
          </Button>
          <Button variant="ghost" size="xs" onClick={() => setConfirmDelete(false)}>
            Отмена
          </Button>
        </>
      ) : (
        <Button variant="ghost" size="xs" disabled={busy} onClick={() => setConfirmDelete(true)} className="gap-1">
          <Trash2 className="size-3" /> Удалить
        </Button>
      )}

      <Button variant="ghost" size="xs" onClick={onClear}>
        Снять выбор
      </Button>
    </div>
  );
}
