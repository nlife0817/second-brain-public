"use client";

// Подзадачи в карточке задачи. Подзадача — обычная задача с родителем, поэтому
// и заводится она так же, как в «Все задачи»: черновиком со всеми полями, а не
// одной строкой названия.
//
// Колонок в карточке нет (её ширина — 576 px), поэтому редакторы полей собраны
// в компактные чипы над теми же меню, что и в строке таблицы (`draft-controls`).
// «Развернуть» раскрывает остальные поля прямо здесь: второй боковой панелью
// поверх карточки это на телефоне давало бы две наложенные шторки.

import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  CalendarDays,
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  Circle,
  Clock,
  MoreHorizontal,
  Plus,
  RotateCcw,
  Trash2,
  Unlink,
  UserPlus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  AvatarStack,
  PRIORITY_LABELS,
  PriorityDot,
  dueTone,
  formatDue,
} from "@/components/v2/bits";
import { emptyDraft, isDraftFilled, type TaskDraft } from "@/lib/core/task-draft";
import type { CustomField, TaskListItem } from "@/lib/core/types";
import { useV2Store } from "@/lib/core/ui-store";
import { cn } from "@/lib/utils";
import { formatEstimate } from "./cells";
import {
  AssigneesMenu,
  DUE_POPOVER,
  DueForm,
  ESTIMATE_POPOVER,
  EstimateForm,
  FIELD_POPOVER,
  MENU_POPOVER,
  PRIORITY_POPOVER,
  PriorityMenu,
  ProjectsMenu,
  StatusMenu,
  TagsMenu,
  WIDE_MENU_POPOVER,
} from "./draft-controls";
import { DraftFieldControl, describeFieldValue } from "./draft-fields";

const RichText = dynamic(() => import("@/components/v2/RichText").then((m) => m.RichText), {
  ssr: false,
  loading: () => (
    <div className="min-h-16 rounded-lg border border-border bg-background px-3 py-2 text-sm text-muted-foreground">
      Загрузка редактора…
    </div>
  ),
});

const CHIP =
  "flex h-7 shrink-0 items-center gap-1 rounded-md px-1.5 text-xs transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";
const CHIP_EMPTY = "text-muted-foreground/70";
const CHIP_SET = "text-foreground";

export function SubtaskSection({
  subtasks,
  canEdit,
  defaults,
  onCreate,
  onToggleDone,
  onOpen,
  onDelete,
  onDetach,
}: {
  subtasks: TaskListItem[];
  canEdit: boolean;
  /** Что карточка проставляет в черновик подзадачи — проекты родителя и т.п. */
  defaults: Partial<TaskDraft>;
  onCreate: (draft: TaskDraft) => Promise<void>;
  onToggleDone: (sub: TaskListItem) => void;
  onOpen: (taskId: string) => void;
  onDelete: (sub: TaskListItem) => void;
  onDetach: (sub: TaskListItem) => void;
}) {
  const done = subtasks.filter((s) => s.completed_at).length;

  return (
    <div>
      <p className="mb-1.5 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Подзадачи
        {subtasks.length > 0 && (
          <span className="tabular-nums font-normal normal-case tracking-normal">
            {done}/{subtasks.length}
          </span>
        )}
      </p>
      <div className="flex flex-col gap-0.5">
        {subtasks.map((s) => (
          <SubtaskRow
            key={s.id}
            sub={s}
            canEdit={canEdit}
            onToggleDone={onToggleDone}
            onOpen={onOpen}
            onDelete={onDelete}
            onDetach={onDetach}
          />
        ))}
        {canEdit && <SubtaskComposer defaults={defaults} onCreate={onCreate} />}
      </div>
    </div>
  );
}

// --- Строка подзадачи ---------------------------------------------------------------

function SubtaskRow({
  sub,
  canEdit,
  onToggleDone,
  onOpen,
  onDelete,
  onDetach,
}: {
  sub: TaskListItem;
  canEdit: boolean;
  onToggleDone: (sub: TaskListItem) => void;
  onOpen: (taskId: string) => void;
  onDelete: (sub: TaskListItem) => void;
  onDetach: (sub: TaskListItem) => void;
}) {
  const isDone = !!sub.completed_at;
  const due = formatDue(sub.due_date, sub.due_time);

  return (
    <div className="flex items-center gap-2 rounded-md px-1 py-0.5 hover:bg-muted/50">
      <button
        onClick={() => onToggleDone(sub)}
        title={isDone ? "Вернуть в работу" : "Завершить"}
        className="shrink-0"
      >
        {isDone ? (
          <CheckCircle2 className="size-4 text-emerald-500" />
        ) : (
          <Circle className="size-4 text-muted-foreground" />
        )}
      </button>
      {/* Название открывает карточку подзадачи: она такая же задача, и все её
          поля правятся там же, где у обычной. */}
      <button
        onClick={() => onOpen(sub.id)}
        className={cn(
          "min-w-0 flex-1 truncate py-0.5 text-left text-sm hover:underline",
          isDone && "text-muted-foreground line-through",
        )}
        title={sub.title}
      >
        {sub.title}
      </button>
      {sub.priority !== "none" && (
        <span title={PRIORITY_LABELS[sub.priority].label}>
          <PriorityDot priority={sub.priority} />
        </span>
      )}
      {due && (
        <span className={cn("shrink-0 text-[11px] tabular-nums", dueTone(sub.due_date, isDone))}>
          {due}
        </span>
      )}
      {sub.assignees.length > 0 && <AvatarStack users={sub.assignees} max={2} />}
      {canEdit && (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <button
                className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                title="Действия"
              />
            }
          >
            <MoreHorizontal className="size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuItem onClick={() => onOpen(sub.id)}>Открыть карточку</DropdownMenuItem>
            <DropdownMenuItem onClick={() => onDetach(sub)}>
              <Unlink className="size-3.5" /> Сделать самостоятельной
            </DropdownMenuItem>
            <DropdownMenuItem variant="destructive" onClick={() => onDelete(sub)}>
              <Trash2 className="size-3.5" /> Удалить
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}

// --- Строка добавления --------------------------------------------------------------

function SubtaskComposer({
  defaults,
  onCreate,
}: {
  defaults: Partial<TaskDraft>;
  onCreate: (draft: TaskDraft) => Promise<void>;
}) {
  const [draft, setDraft] = useState<TaskDraft>(() => emptyDraft(defaults));
  const [expanded, setExpanded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const titleRef = useRef<HTMLInputElement>(null);

  // Описание отдаётся редактором по blur: клик по «Сохранить» сначала снимает
  // с него фокус, и обработчик видел бы черновик прошлого рендера.
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
      setError(null);
      titleRef.current?.focus();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось создать подзадачу");
    } finally {
      setSaving(false);
    }
  }, [onCreate, saving, defaults]);

  const filled = isDraftFilled(draft, defaults);

  return (
    <div className="mt-1 rounded-md border border-dashed border-border">
      {/* flex-wrap: на телефоне чипы уезжают на вторую строку, а не сжимают
          поле названия до нечитаемой ширины. */}
      <div className="flex flex-wrap items-center gap-0.5 px-1 py-1">
        <Plus className="size-4 shrink-0 text-muted-foreground" />
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
          placeholder="Новая подзадача…"
          className="h-7 min-w-32 flex-1 bg-transparent px-1 text-sm outline-none placeholder:text-muted-foreground"
        />
        <PriorityChip draft={draft} patch={patch} />
        <StatusChip draft={draft} patch={patch} />
        <AssigneesChip draft={draft} patch={patch} />
        <DueChip draft={draft} patch={patch} />
        <EstimateChip draft={draft} patch={patch} />
        <button
          onClick={() => setExpanded((v) => !v)}
          className={cn(CHIP, CHIP_EMPTY)}
          title={expanded ? "Свернуть поля" : "Развернуть: описание, теги, проекты"}
        >
          {expanded ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
        </button>
      </div>

      {expanded && <SubtaskDraftDetails draft={draft} patch={patch} />}

      {(filled || expanded) && (
        <div className="flex flex-wrap items-center gap-1.5 border-t border-border px-2 py-1.5">
          <Button size="xs" onClick={() => void save()} disabled={saving || !draft.title.trim()}>
            {saving ? "Сохранение…" : "Добавить"}
          </Button>
          {filled && (
            <Button variant="ghost" size="xs" className="gap-1" onClick={reset} disabled={saving}>
              <RotateCcw className="size-3" />
              Очистить
            </Button>
          )}
          {error ? (
            <span className="text-xs text-destructive">{error}</span>
          ) : (
            <span className="text-[11px] text-muted-foreground">Enter — добавить, Esc — очистить</span>
          )}
        </div>
      )}
    </div>
  );
}

/** Поля, которым тесно в строке: описание, теги, проекты, кастомные поля. */
function SubtaskDraftDetails({ draft, patch }: DraftProps) {
  const fields = useV2Store((s) => s.fields);
  const tags = useV2Store((s) => s.tags);
  const projects = useV2Store((s) => s.projects);
  // Поле проекта показываем, только если задача в этот проект и правда попадёт.
  const visibleFields = fields.filter(
    (f) => !f.project_id || draft.project_ids.includes(f.project_id),
  );
  const selectedTags = tags.filter((t) => draft.tag_ids.includes(t.id));

  return (
    <div className="flex flex-col gap-2 border-t border-border px-2 py-2">
      <div className="grid grid-cols-[76px_1fr] items-center gap-x-2 gap-y-1.5 text-xs">
        <span className="text-muted-foreground">Проекты</span>
        <Popover>
          <PopoverTrigger render={<button className={cn(CHIP, "w-full justify-start gap-1")} />}>
            {draft.project_ids.length === 0 ? (
              <span className={CHIP_EMPTY}>Личная подзадача</span>
            ) : (
              draft.project_ids.map((id) => {
                const project = projects.find((p) => p.id === id);
                return (
                  <span
                    key={id}
                    className="inline-flex max-w-full items-center gap-1 truncate rounded px-1.5 py-0.5"
                    style={{
                      backgroundColor: `${project?.color ?? "#94a3b8"}1a`,
                      color: project?.color ?? undefined,
                    }}
                  >
                    <span className="truncate">{project?.name ?? "—"}</span>
                  </span>
                );
              })
            )}
          </PopoverTrigger>
          <PopoverContent align="start" className={WIDE_MENU_POPOVER}>
            <ProjectsMenu value={draft.project_ids} onChange={(project_ids) => patch({ project_ids })} />
          </PopoverContent>
        </Popover>

        <span className="text-muted-foreground">Теги</span>
        <Popover>
          <PopoverTrigger render={<button className={cn(CHIP, "w-full justify-start gap-1")} />}>
            {selectedTags.length === 0 ? (
              <span className={CHIP_EMPTY}>Не выбраны</span>
            ) : (
              selectedTags.map((t) => (
                <span
                  key={t.id}
                  className="truncate rounded px-1.5 py-0.5 text-[11px]"
                  style={{ backgroundColor: `${t.color}1a`, color: t.color }}
                >
                  {t.name}
                </span>
              ))
            )}
          </PopoverTrigger>
          <PopoverContent align="start" className={MENU_POPOVER}>
            <TagsMenu value={draft.tag_ids} onChange={(tag_ids) => patch({ tag_ids })} />
          </PopoverContent>
        </Popover>

        {visibleFields.map((f) => (
          <CustomFieldChip key={f.id} field={f} draft={draft} patch={patch} />
        ))}
      </div>

      <RichText
        value={draft.description}
        onSave={(html) => patch({ description: html })}
        placeholder="Описание подзадачи…"
      />
    </div>
  );
}

// --- Чипы редакторов ----------------------------------------------------------------

interface DraftProps {
  draft: TaskDraft;
  patch: (change: Partial<TaskDraft>) => void;
}

function PriorityChip({ draft, patch }: DraftProps) {
  const set = draft.priority !== "none";
  return (
    <Popover>
      <PopoverTrigger
        render={
          <button
            className={cn(CHIP, set ? CHIP_SET : CHIP_EMPTY)}
            title={`Приоритет: ${PRIORITY_LABELS[draft.priority].label}`}
          />
        }
      >
        {set ? (
          <PriorityDot priority={draft.priority} />
        ) : (
          <span className="size-2 rounded-full border border-dashed border-muted-foreground/60" />
        )}
      </PopoverTrigger>
      <PopoverContent align="start" className={PRIORITY_POPOVER}>
        <PriorityMenu value={draft.priority} onChange={(priority) => patch({ priority })} />
      </PopoverContent>
    </Popover>
  );
}

function StatusChip({ draft, patch }: DraftProps) {
  const statuses = useV2Store((s) => s.statuses);
  const status = statuses.find((s) => s.id === draft.status_id);
  return (
    <Popover>
      <PopoverTrigger
        render={
          <button
            className={cn(CHIP, "max-w-32", status ? CHIP_SET : CHIP_EMPTY)}
            title="Статус"
          />
        }
      >
        {status ? (
          <span
            className="inline-flex max-w-full items-center gap-1 truncate rounded-full px-1.5 py-0.5 text-[11px] font-medium"
            style={{ backgroundColor: `${status.color}1a`, color: status.color }}
          >
            <span className="size-1.5 shrink-0 rounded-full" style={{ backgroundColor: status.color }} />
            <span className="truncate">{status.name}</span>
          </span>
        ) : (
          <span className="size-2 rounded-full border border-dashed border-muted-foreground/60" />
        )}
      </PopoverTrigger>
      <PopoverContent align="start" className={MENU_POPOVER}>
        <StatusMenu value={draft.status_id} onChange={(status_id) => patch({ status_id })} />
      </PopoverContent>
    </Popover>
  );
}

function AssigneesChip({ draft, patch }: DraftProps) {
  const members = useV2Store((s) => s.members);
  const selected = members.filter((m) => draft.assignee_ids.includes(m.user_id));
  return (
    <Popover>
      <PopoverTrigger
        render={
          <button
            className={cn(CHIP, selected.length > 0 ? CHIP_SET : CHIP_EMPTY)}
            title="Исполнители"
          />
        }
      >
        {selected.length > 0 ? (
          <AvatarStack
            users={selected.map((m) => ({
              id: m.user_id,
              email: m.email,
              name: m.name,
              avatar_url: m.avatar_url,
            }))}
            max={2}
          />
        ) : (
          <UserPlus className="size-3.5" />
        )}
      </PopoverTrigger>
      <PopoverContent align="start" className={WIDE_MENU_POPOVER}>
        <AssigneesMenu value={draft.assignee_ids} onChange={(assignee_ids) => patch({ assignee_ids })} />
      </PopoverContent>
    </Popover>
  );
}

function DueChip({ draft, patch }: DraftProps) {
  const text = formatDue(draft.due_date, draft.due_time);
  return (
    <Popover>
      <PopoverTrigger
        render={<button className={cn(CHIP, text ? CHIP_SET : CHIP_EMPTY)} title="Срок" />}
      >
        {text ? (
          <span className={cn("tabular-nums", dueTone(draft.due_date, false))}>{text}</span>
        ) : (
          <CalendarDays className="size-3.5" />
        )}
      </PopoverTrigger>
      <PopoverContent align="start" className={DUE_POPOVER}>
        <DueForm date={draft.due_date} time={draft.due_time} onChange={patch} />
      </PopoverContent>
    </Popover>
  );
}

function EstimateChip({ draft, patch }: DraftProps) {
  const set = draft.estimated_minutes != null;
  return (
    <Popover>
      <PopoverTrigger
        render={<button className={cn(CHIP, set ? CHIP_SET : CHIP_EMPTY)} title="Оценка" />}
      >
        {set ? (
          <span className="tabular-nums">{formatEstimate(draft.estimated_minutes!)}</span>
        ) : (
          <Clock className="size-3.5" />
        )}
      </PopoverTrigger>
      <PopoverContent align="start" className={ESTIMATE_POPOVER}>
        <EstimateForm
          value={draft.estimated_minutes}
          onChange={(estimated_minutes) => patch({ estimated_minutes })}
        />
      </PopoverContent>
    </Popover>
  );
}

function CustomFieldChip({ field, draft, patch }: DraftProps & { field: CustomField }) {
  const text = describeFieldValue(field, draft.field_values[field.id]);
  return (
    <>
      <span className="truncate text-muted-foreground" title={field.name}>
        {field.name}
      </span>
      <Popover>
        <PopoverTrigger
          render={<button className={cn(CHIP, "w-full justify-start", text ? CHIP_SET : CHIP_EMPTY)} />}
        >
          <span className="truncate">{text || "Не задано"}</span>
        </PopoverTrigger>
        <PopoverContent align="start" className={FIELD_POPOVER}>
          <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            {field.name}
          </span>
          <DraftFieldControl
            field={field}
            value={draft.field_values[field.id]}
            onChange={(value) => patch({ field_values: { ...draft.field_values, [field.id]: value } })}
          />
        </PopoverContent>
      </Popover>
    </>
  );
}
