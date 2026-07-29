"use client";

// Строка создания задачи: те же колонки, что и у таблицы, только редакторы
// пишут в черновик, а не патчат сервер. Ничего не создаётся, пока не нажали
// «Сохранить» (или Enter в названии) — поэтому задачу можно собрать целиком,
// а не дописывать поля уже созданной строке.
//
// Кнопка «развернуть» показывает тот же черновик в панели справа; закрытие
// панели возвращает его сюда, а не отменяет.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, Maximize2, Plus, RotateCcw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Avatar,
  AvatarStack,
  PRIORITY_LABELS,
  PriorityDot,
  dueTone,
  formatDue,
} from "@/components/v2/bits";
import { DuePicker } from "@/components/v2/DuePicker";
import { emptyDraft, isDraftFilled, type TaskDraft } from "@/lib/core/task-draft";
import type { CustomField, TaskPriority } from "@/lib/core/types";
import { useV2Store } from "@/lib/core/ui-store";
import type { ColumnDef } from "@/lib/core/view-store";
import { cn } from "@/lib/utils";
import { formatEstimate } from "./cells";
import { DraftFieldControl, describeFieldValue } from "./draft-fields";
import { SELECT_COLUMN_WIDTH } from "./TaskTable";
import { TaskDraftPanel } from "./TaskDraftPanel";

const CELL =
  "flex h-full w-full items-center gap-1 rounded px-1.5 text-left transition-colors hover:bg-muted/70 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";
const PLACEHOLDER = "truncate text-xs text-muted-foreground/70";

const PRIORITY_ORDER: TaskPriority[] = ["urgent", "high", "medium", "low", "none"];
const ESTIMATE_PRESETS = [15, 30, 60, 120, 240, 480];

export function TaskComposer({
  columns,
  defaults,
  onCreate,
}: {
  columns: ColumnDef[];
  /** Что экран проставляет в новый черновик — например, свой проект. */
  defaults?: Partial<TaskDraft>;
  /** Создание задачи целиком — вместе с кастомными полями и перезагрузкой списка. */
  onCreate: (draft: TaskDraft) => Promise<void>;
}) {
  const [draft, setDraft] = useState<TaskDraft>(() => emptyDraft(defaults));
  const [expanded, setExpanded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const titleRef = useRef<HTMLInputElement>(null);

  // Описание в развёрнутой панели отдаётся по blur: клик по «Сохранить» сначала
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
      <div className="border-b border-border bg-muted/20">
        <div className="flex h-8 items-stretch">
          <div
            className="flex shrink-0 items-center justify-center"
            style={{ width: SELECT_COLUMN_WIDTH }}
          >
            <Plus className="size-3.5 text-muted-foreground" />
          </div>
          {columns.map((column) => (
            <div
              key={column.id}
              className="flex shrink-0 items-center overflow-hidden"
              style={{ width: column.width }}
            >
              <DraftCell
                column={column}
                draft={draft}
                patch={patch}
                titleRef={titleRef}
                onSubmit={() => void save()}
                onEscape={reset}
              />
            </div>
          ))}
        </div>

        {/* Прилипает к левому краю: при горизонтальной прокрутке кнопки
            остаются на виду, иначе они уезжают вместе с последней колонкой. */}
        <div className="sticky left-0 flex w-max max-w-full items-center gap-1.5 px-2 py-1.5">
          <Button size="xs" onClick={() => void save()} disabled={saving || !draft.title.trim()}>
            {saving ? "Сохранение…" : "Сохранить"}
          </Button>
          <Button
            variant="ghost"
            size="xs"
            className="gap-1"
            onClick={() => setExpanded(true)}
            title="Развернуть черновик со всеми полями"
          >
            <Maximize2 className="size-3" />
            Развернуть
          </Button>
          {filled && (
            <Button variant="ghost" size="xs" className="gap-1" onClick={reset} disabled={saving}>
              <RotateCcw className="size-3" />
              Очистить
            </Button>
          )}
          {error ? (
            <span className="truncate text-xs text-destructive">{error}</span>
          ) : (
            <span className="hidden truncate text-[11px] text-muted-foreground lg:inline">
              Enter — сохранить, Esc — очистить
            </span>
          )}
        </div>
      </div>

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
    </>
  );
}

// --- Ячейки строки ------------------------------------------------------------------

interface CellProps {
  draft: TaskDraft;
  patch: (change: Partial<TaskDraft>) => void;
}

function DraftCell({
  column,
  draft,
  patch,
  titleRef,
  onSubmit,
  onEscape,
}: CellProps & {
  column: ColumnDef;
  titleRef: React.RefObject<HTMLInputElement | null>;
  onSubmit: () => void;
  onEscape: () => void;
}) {
  switch (column.id) {
    case "title":
      return (
        <input
          ref={titleRef}
          value={draft.title}
          onChange={(e) => patch({ title: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              onSubmit();
            }
            if (e.key === "Escape") {
              e.preventDefault();
              onEscape();
            }
          }}
          placeholder="Новая задача…"
          className="h-full w-full bg-transparent px-1.5 text-sm outline-none placeholder:text-muted-foreground/70"
        />
      );
    case "priority":
      return <PriorityDraftCell draft={draft} patch={patch} />;
    case "status":
      return <StatusDraftCell draft={draft} patch={patch} />;
    case "project":
      return <ProjectDraftCell draft={draft} patch={patch} />;
    case "assignees":
      return <AssigneesDraftCell draft={draft} patch={patch} />;
    case "tags":
      return <TagsDraftCell draft={draft} patch={patch} />;
    case "due_date":
      return <DueDraftCell draft={draft} patch={patch} />;
    case "estimated_minutes":
      return <EstimateDraftCell draft={draft} patch={patch} />;
    default: {
      const fieldId = column.id.startsWith("field:") ? column.id.slice("field:".length) : null;
      if (fieldId) return <CustomFieldDraftCell fieldId={fieldId} draft={draft} patch={patch} />;
      // Подзадачи, комментарии, даты создания — у ещё не созданной задачи их нет.
      return <span className="px-1.5 text-xs text-muted-foreground/50">—</span>;
    }
  }
}

function PriorityDraftCell({ draft, patch }: CellProps) {
  return (
    <Popover>
      <PopoverTrigger
        render={
          <button
            className={cn(CELL, "justify-center")}
            title={PRIORITY_LABELS[draft.priority].label}
          />
        }
      >
        {draft.priority === "none" ? (
          <span className="size-2 rounded-full border border-dashed border-muted-foreground/50" />
        ) : (
          <PriorityDot priority={draft.priority} />
        )}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-44 p-1">
        {PRIORITY_ORDER.map((p) => (
          <button
            key={p}
            onClick={() => patch({ priority: p })}
            className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted"
          >
            <span className={cn("size-2 shrink-0 rounded-full", PRIORITY_LABELS[p].dot)} />
            <span className="flex-1 text-left">{PRIORITY_LABELS[p].label}</span>
            {draft.priority === p && <Check className="size-3.5" />}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}

function StatusDraftCell({ draft, patch }: CellProps) {
  const statuses = useV2Store((s) => s.statuses);
  const status = statuses.find((s) => s.id === draft.status_id);

  return (
    <Popover>
      <PopoverTrigger render={<button className={CELL} />}>
        {status ? (
          <span
            className="inline-flex max-w-full items-center gap-1.5 truncate rounded-full px-2 py-0.5 text-xs font-medium"
            style={{ backgroundColor: `${status.color}1a`, color: status.color }}
          >
            <span className="size-1.5 shrink-0 rounded-full" style={{ backgroundColor: status.color }} />
            <span className="truncate">{status.name}</span>
          </span>
        ) : (
          <span className={PLACEHOLDER}>Статус</span>
        )}
      </PopoverTrigger>
      <PopoverContent align="start" className="max-h-72 w-56 overflow-y-auto p-1">
        {statuses.map((s) => (
          <button
            key={s.id}
            onClick={() => patch({ status_id: s.id })}
            className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted"
          >
            <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: s.color }} />
            <span className="flex-1 truncate text-left">{s.name}</span>
            {draft.status_id === s.id && <Check className="size-3.5 shrink-0" />}
          </button>
        ))}
        <button
          onClick={() => patch({ status_id: null })}
          className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm text-muted-foreground hover:bg-muted"
        >
          <X className="size-3.5" /> Без статуса
        </button>
      </PopoverContent>
    </Popover>
  );
}

/** Проекты, куда участник вправе положить задачу. Архивные не предлагаем. */
function useWritableProjects() {
  const projects = useV2Store((s) => s.projects);
  return useMemo(
    () => projects.filter((p) => !p.archived_at && (p.my_role === "admin" || p.my_role === "editor")),
    [projects],
  );
}

function ProjectDraftCell({ draft, patch }: CellProps) {
  const projects = useV2Store((s) => s.projects);
  const writable = useWritableProjects();

  function toggle(projectId: string) {
    patch({
      project_ids: draft.project_ids.includes(projectId)
        ? draft.project_ids.filter((id) => id !== projectId)
        : [...draft.project_ids, projectId],
    });
  }

  return (
    <Popover>
      <PopoverTrigger render={<button className={cn(CELL, "gap-1 overflow-hidden")} />}>
        {draft.project_ids.length === 0 ? (
          <span className={PLACEHOLDER}>Личная</span>
        ) : (
          draft.project_ids.map((id) => {
            const project = projects.find((p) => p.id === id);
            return (
              <span
                key={id}
                className="inline-flex max-w-full items-center truncate rounded px-1.5 py-0.5 text-xs"
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
      <PopoverContent align="start" className="max-h-72 w-60 overflow-y-auto p-1">
        {writable.map((p) => (
          <button
            key={p.id}
            onClick={() => toggle(p.id)}
            className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted"
          >
            <span className="size-2 shrink-0 rounded-sm" style={{ backgroundColor: p.color }} />
            <span className="flex-1 truncate text-left">{p.name}</span>
            {draft.project_ids.includes(p.id) && <Check className="size-3.5 shrink-0" />}
          </button>
        ))}
        {writable.length === 0 && (
          <p className="px-2 py-1.5 text-xs text-muted-foreground">
            Нет проектов, куда можно добавить задачу — она уйдёт в личный инбокс.
          </p>
        )}
      </PopoverContent>
    </Popover>
  );
}

function AssigneesDraftCell({ draft, patch }: CellProps) {
  const members = useV2Store((s) => s.members);
  const selected = members.filter((m) => draft.assignee_ids.includes(m.user_id));

  function toggle(userId: string) {
    patch({
      assignee_ids: draft.assignee_ids.includes(userId)
        ? draft.assignee_ids.filter((id) => id !== userId)
        : [...draft.assignee_ids, userId],
    });
  }

  return (
    <Popover>
      <PopoverTrigger render={<button className={CELL} />}>
        {selected.length > 0 ? (
          <AvatarStack
            users={selected.map((m) => ({
              id: m.user_id,
              email: m.email,
              name: m.name,
              avatar_url: m.avatar_url,
            }))}
            max={3}
          />
        ) : (
          <span className={PLACEHOLDER}>Исполнители</span>
        )}
      </PopoverTrigger>
      <PopoverContent align="start" className="max-h-72 w-60 overflow-y-auto p-1">
        {members.map((m) => (
          <button
            key={m.user_id}
            onClick={() => toggle(m.user_id)}
            className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted"
          >
            <Avatar
              user={{ id: m.user_id, email: m.email, name: m.name, avatar_url: m.avatar_url }}
              size="xs"
            />
            <span className="flex-1 truncate text-left">{m.name || m.email}</span>
            {draft.assignee_ids.includes(m.user_id) && <Check className="size-3.5 shrink-0" />}
          </button>
        ))}
        {members.length === 0 && (
          <p className="px-2 py-1.5 text-xs text-muted-foreground">Участники ещё не загружены</p>
        )}
      </PopoverContent>
    </Popover>
  );
}

function TagsDraftCell({ draft, patch }: CellProps) {
  const tags = useV2Store((s) => s.tags);
  const selected = tags.filter((t) => draft.tag_ids.includes(t.id));

  function toggle(tagId: string) {
    patch({
      tag_ids: draft.tag_ids.includes(tagId)
        ? draft.tag_ids.filter((id) => id !== tagId)
        : [...draft.tag_ids, tagId],
    });
  }

  return (
    <Popover>
      <PopoverTrigger render={<button className={CELL} />}>
        {selected.length > 0 ? (
          <span className="flex gap-1 overflow-hidden">
            {selected.map((t) => (
              <span
                key={t.id}
                className="truncate rounded px-1.5 py-0.5 text-[11px]"
                style={{ backgroundColor: `${t.color}1a`, color: t.color }}
              >
                {t.name}
              </span>
            ))}
          </span>
        ) : (
          <span className={PLACEHOLDER}>Теги</span>
        )}
      </PopoverTrigger>
      <PopoverContent align="start" className="max-h-72 w-56 overflow-y-auto p-1">
        {tags.map((t) => (
          <button
            key={t.id}
            onClick={() => toggle(t.id)}
            className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted"
          >
            <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: t.color }} />
            <span className="flex-1 truncate text-left">{t.name}</span>
            {draft.tag_ids.includes(t.id) && <Check className="size-3.5 shrink-0" />}
          </button>
        ))}
        {tags.length === 0 && <p className="px-2 py-1.5 text-xs text-muted-foreground">Тегов пока нет</p>}
      </PopoverContent>
    </Popover>
  );
}

function DueDraftCell({ draft, patch }: CellProps) {
  const text = formatDue(draft.due_date, draft.due_time);
  return (
    <DuePicker
      date={draft.due_date}
      time={draft.due_time}
      triggerClassName={CELL}
      onCommit={(next) => patch(next)}
    >
      {text ? (
        <span className={cn("truncate text-xs", dueTone(draft.due_date, false))}>{text}</span>
      ) : (
        <span className={PLACEHOLDER}>Срок</span>
      )}
    </DuePicker>
  );
}

function EstimateDraftCell({ draft, patch }: CellProps) {
  return (
    <Popover>
      <PopoverTrigger render={<button className={CELL} />}>
        {draft.estimated_minutes == null ? (
          <span className={PLACEHOLDER}>Оценка</span>
        ) : (
          <span className="truncate text-xs tabular-nums">
            {formatEstimate(draft.estimated_minutes)}
          </span>
        )}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-52 gap-2 p-2.5">
        <div className="flex flex-wrap gap-1">
          {ESTIMATE_PRESETS.map((m) => (
            <button
              key={m}
              onClick={() => patch({ estimated_minutes: m })}
              className={cn(
                "rounded border border-border px-2 py-1 text-xs hover:bg-muted",
                draft.estimated_minutes === m && "border-primary bg-primary/10 text-primary",
              )}
            >
              {formatEstimate(m)}
            </button>
          ))}
        </div>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Минут
          <input
            type="number"
            min={0}
            step={5}
            value={draft.estimated_minutes ?? ""}
            onChange={(e) =>
              patch({
                estimated_minutes: e.target.value === "" ? null : Math.max(0, Number(e.target.value)),
              })
            }
            className="h-8 rounded-lg border border-input bg-transparent px-2 text-sm text-foreground outline-none focus-visible:border-ring"
          />
        </label>
        {draft.estimated_minutes != null && (
          <button
            onClick={() => patch({ estimated_minutes: null })}
            className="flex items-center gap-1.5 rounded px-1 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="size-3.5" /> Убрать оценку
          </button>
        )}
      </PopoverContent>
    </Popover>
  );
}

function CustomFieldDraftCell({
  fieldId,
  draft,
  patch,
}: CellProps & {
  fieldId: string;
}) {
  const fields = useV2Store((s) => s.fields);
  const field: CustomField | undefined = fields.find((f) => f.id === fieldId);
  if (!field) return <span className="px-1.5 text-xs text-muted-foreground/50">—</span>;

  const text = describeFieldValue(field, draft.field_values[fieldId]);

  return (
    <Popover>
      <PopoverTrigger render={<button className={CELL} />}>
        {text ? (
          <span className="truncate text-xs" title={text}>
            {text}
          </span>
        ) : (
          <span className={PLACEHOLDER}>{field.name}</span>
        )}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 gap-2 p-2.5">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          {field.name}
        </span>
        <DraftFieldControl
          field={field}
          value={draft.field_values[fieldId]}
          onChange={(value) => patch({ field_values: { ...draft.field_values, [fieldId]: value } })}
        />
      </PopoverContent>
    </Popover>
  );
}
