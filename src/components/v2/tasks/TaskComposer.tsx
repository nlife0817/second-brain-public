"use client";

// Строка создания задачи: те же колонки, что и у таблицы, только редакторы
// пишут в черновик, а не патчат сервер. Ничего не создаётся, пока не нажали
// «Сохранить» (или Enter в названии) — поэтому задачу можно собрать целиком,
// а не дописывать поля уже созданной строке.
//
// Кнопка «развернуть» показывает тот же черновик в панели справа; закрытие
// панели возвращает его сюда, а не отменяет.

import { useCallback, useEffect, useRef, useState } from "react";
import { Maximize2, Plus, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  AvatarStack,
  PRIORITY_LABELS,
  PriorityDot,
  chipStyle,
  dueTone,
  formatDue,
} from "@/components/v2/bits";
import { DatePicker, DuePicker, StartPicker } from "@/components/v2/DuePicker";
import { defaultStatus } from "@/lib/core/status-model";
import { emptyDraft, isDraftFilled, type TaskDraft } from "@/lib/core/task-draft";
import type { CustomField } from "@/lib/core/types";
import { useV2Store } from "@/lib/core/ui-store";
import type { ColumnDef } from "@/lib/core/view-store";
import { cn } from "@/lib/utils";
import { TREE_TOGGLE_W, formatEstimate } from "./cells";
import {
  AssigneesMenu,
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
  useDraftSetStatuses,
} from "./draft-controls";
import { DraftFieldControl, describeFieldValue } from "./draft-fields";
import { SELECT_COLUMN_WIDTH } from "./TaskTable";
import { TaskDraftPanel } from "./TaskDraftPanel";

const CELL =
  "flex h-full w-full items-center gap-0.5 rounded px-1 text-left transition-colors hover:bg-muted/70 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";
const PLACEHOLDER = "truncate text-xs text-muted-foreground/70";

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
      {/* Пунктирная рамка и зазор снизу: строка создания стоит вплотную к
          заголовку первой группы, и со сплошной нижней границей читалась как
          ещё одна строка данных. */}
      <div className="mb-1.5 rounded-md border border-dashed border-border bg-muted/30">
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
          {error && <span className="truncate text-xs text-destructive">{error}</span>}
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
          // Слева тот же слот шеврона, что и у строк: без него поле ввода
          // стоит на 18 px левее названий, под которые оно и подписано.
          style={{ paddingLeft: TREE_TOGGLE_W + 6 }}
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
    case "start_date":
      return <StartDraftCell draft={draft} patch={patch} />;
    case "due_date":
      return <DueDraftCell draft={draft} patch={patch} />;
    case "planned_date":
      return <PlannedDraftCell draft={draft} patch={patch} />;
    case "estimated_minutes":
      return <EstimateDraftCell draft={draft} patch={patch} />;
    default: {
      const fieldId = column.id.startsWith("field:") ? column.id.slice("field:".length) : null;
      if (fieldId) return <CustomFieldDraftCell fieldId={fieldId} draft={draft} patch={patch} />;
      // Подзадачи, комментарии, даты создания — у ещё не созданной задачи их
      // нет; ячейка просто молчит, как пустые ячейки таблицы.
      return <span className="px-1.5" />;
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
      <PopoverContent align="start" className={PRIORITY_POPOVER}>
        <PriorityMenu value={draft.priority} onChange={(priority) => patch({ priority })} />
      </PopoverContent>
    </Popover>
  );
}

function StatusDraftCell({ draft, patch }: CellProps) {
  // Статусы набора проекта черновика, а не весь справочник организации (наборы,
  // 0052): новая задача рождается в процессе своего проекта.
  const statuses = useDraftSetStatuses(draft.project_ids);
  // Черновик хранит null, пока статус не выбрали, но показать надо тот, с
  // которым задача родится, — иначе строка врёт про будущий результат.
  const status = statuses.find((s) => s.id === draft.status_id) ?? defaultStatus(statuses);

  return (
    <Popover>
      <PopoverTrigger render={<button className={CELL} />}>
        {status ? (
          <span
            className="tinted-chip inline-flex max-w-full items-center gap-1.5 truncate rounded-full px-2 py-0.5 text-xs font-medium"
            style={chipStyle(status.color)}
          >
            <span className="size-1.5 shrink-0 rounded-full" style={{ backgroundColor: status.color }} />
            <span className="truncate">{status.name}</span>
          </span>
        ) : (
          <span className={PLACEHOLDER}>Статус</span>
        )}
      </PopoverTrigger>
      <PopoverContent align="start" className={MENU_POPOVER}>
        <StatusMenu
          value={draft.status_id}
          statuses={statuses}
          onChange={(status_id) => patch({ status_id })}
        />
      </PopoverContent>
    </Popover>
  );
}

function ProjectDraftCell({ draft, patch }: CellProps) {
  const projects = useV2Store((s) => s.projects);

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
                className="tinted-chip inline-flex max-w-full items-center truncate rounded px-1.5 py-0.5 text-xs"
                style={chipStyle(project?.color)}
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
  );
}

function AssigneesDraftCell({ draft, patch }: CellProps) {
  const members = useV2Store((s) => s.members);
  const selected = members.filter((m) => draft.assignee_ids.includes(m.user_id));

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
      <PopoverContent align="start" className={WIDE_MENU_POPOVER}>
        <AssigneesMenu
          value={draft.assignee_ids}
          projectIds={draft.project_ids}
          onChange={(assignee_ids) => patch({ assignee_ids })}
        />
      </PopoverContent>
    </Popover>
  );
}

function TagsDraftCell({ draft, patch }: CellProps) {
  const tags = useV2Store((s) => s.tags);
  const selected = tags.filter((t) => draft.tag_ids.includes(t.id));

  return (
    <Popover>
      <PopoverTrigger render={<button className={CELL} />}>
        {selected.length > 0 ? (
          <span className="flex gap-1 overflow-hidden">
            {selected.map((t) => (
              <span
                key={t.id}
                className="tinted-chip truncate rounded px-1.5 py-0.5 text-[11px]"
                style={chipStyle(t.color)}
              >
                {t.name}
              </span>
            ))}
          </span>
        ) : (
          <span className={PLACEHOLDER}>Теги</span>
        )}
      </PopoverTrigger>
      <PopoverContent align="start" className={MENU_POPOVER}>
        <TagsMenu value={draft.tag_ids} onChange={(tag_ids) => patch({ tag_ids })} />
      </PopoverContent>
    </Popover>
  );
}

function StartDraftCell({ draft, patch }: CellProps) {
  const text = formatDue(draft.start_date, draft.start_time);
  return (
    <StartPicker
      date={draft.start_date}
      time={draft.start_time}
      triggerClassName={CELL}
      onCommit={(next) => patch(next)}
    >
      {text ? (
        <span className="truncate text-xs tabular-nums">{text}</span>
      ) : (
        <span className={PLACEHOLDER}>Начало</span>
      )}
    </StartPicker>
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

function PlannedDraftCell({ draft, patch }: CellProps) {
  const text = formatDue(draft.planned_date, null);
  return (
    <DatePicker
      date={draft.planned_date}
      triggerClassName={CELL}
      onCommit={(planned_date) => patch({ planned_date })}
    >
      {text ? (
        <span className={cn("truncate text-xs", dueTone(draft.planned_date, false))}>{text}</span>
      ) : (
        <span className={PLACEHOLDER}>В работу</span>
      )}
    </DatePicker>
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
      <PopoverContent align="start" className={ESTIMATE_POPOVER}>
        <EstimateForm
          value={draft.estimated_minutes}
          onChange={(estimated_minutes) => patch({ estimated_minutes })}
        />
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
  if (!field) return <span className="px-1.5" />;

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
      <PopoverContent align="start" className={FIELD_POPOVER}>
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
