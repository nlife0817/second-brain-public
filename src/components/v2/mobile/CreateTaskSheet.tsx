"use client";

// Создание задачи на телефоне: нижний лист с названием и всеми параметрами
// черновика — статус, приоритет, срок, оценка, исполнители, проекты, теги.
// Меню полей — общие с строкой создания в таблице (draft-controls): своя копия
// списков разъехалась бы с десктопом при первом же новом правиле (закрытые
// проекты, архив и т.п.).

import { useState } from "react";
import {
  ArrowUp,
  Calendar,
  CircleDashed,
  Clock,
  Flag,
  Folder,
  Tag,
  Users,
  X,
} from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { PRIORITY_LABELS, formatDue } from "@/components/v2/bits";
import { formatEstimate } from "@/components/v2/tasks/cells";
import {
  AssigneesMenu,
  ESTIMATE_POPOVER,
  EstimateForm,
  MENU_POPOVER,
  PriorityMenu,
  ProjectsMenu,
  StatusMenu,
  TagsMenu,
} from "@/components/v2/tasks/draft-controls";
import { DuePicker } from "@/components/v2/DuePicker";
import { defaultStatus } from "@/lib/core/status-model";
import { createTaskFromDraft, emptyDraft, type TaskDraft } from "@/lib/core/task-draft";
import type { TaskDetail } from "@/lib/core/types";
import { useV2Store } from "@/lib/core/ui-store";
import { cn } from "@/lib/utils";

/** Чип параметра: рост под палец, залитый — значение выбрано. */
const CHIP =
  "inline-flex h-9 max-w-full items-center gap-1.5 rounded-full border px-3 text-[13px] transition-colors";
const CHIP_EMPTY = "border-border text-muted-foreground active:bg-muted";
const CHIP_SET = "border-primary/40 bg-primary/10 font-medium text-primary";

export function CreateTaskSheet({
  open,
  onOpenChange,
  defaults,
  initialTitle,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Что экран проставляет в черновик (проект, срок и т.п.). */
  defaults?: Partial<TaskDraft>;
  /** Название, начатое в строке быстрого добавления, — переносится сюда. */
  initialTitle?: string;
  onCreated?: (task: TaskDetail) => void;
}) {
  const { orgId, statuses, tags, members, projects } = useV2Store();
  const [draft, setDraft] = useState<TaskDraft>(() => emptyDraft(defaults));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Лист остаётся смонтированным между открытиями: черновик сбрасывается при
  // каждом открытии — в рендере, а не эффектом (см. тот же приём в экранах).
  const [seenOpen, setSeenOpen] = useState(open);
  if (open !== seenOpen) {
    setSeenOpen(open);
    if (open) {
      setDraft(emptyDraft({ ...defaults, title: initialTitle ?? "" }));
      setError(null);
    }
  }

  const set = <K extends keyof TaskDraft>(key: K, value: TaskDraft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  async function submit() {
    if (!orgId || !draft.title.trim() || saving) return;
    setSaving(true);
    setError(null);
    try {
      const { task, fieldsWarning } = await createTaskFromDraft(orgId, draft);
      // Отказ по кастомным полям — предупреждение, но задача уже создана:
      // лист закрываем, а текст показывать негде — полей в нём и нет.
      void fieldsWarning;
      onCreated?.(task);
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось создать задачу");
    } finally {
      setSaving(false);
    }
  }

  const status = draft.status_id
    ? statuses.find((s) => s.id === draft.status_id)
    : defaultStatus(statuses);
  const due = formatDue(draft.due_date, draft.due_time);
  const draftAssignees = draft.assignee_ids
    .map((id) => members.find((m) => m.user_id === id))
    .filter((m): m is NonNullable<typeof m> => !!m);
  const draftProjects = draft.project_ids
    .map((id) => projects.find((p) => p.id === id))
    .filter((p): p is NonNullable<typeof p> => !!p);
  const draftTags = tags.filter((t) => draft.tag_ids.includes(t.id));

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        showCloseButton={false}
        className="max-h-[85dvh] gap-0 rounded-t-2xl pb-[max(env(safe-area-inset-bottom),0.75rem)]"
      >
        <div className="flex items-center gap-2 px-4 pt-3">
          <SheetTitle className="flex-1">Новая задача</SheetTitle>
          <button
            onClick={() => onOpenChange(false)}
            className="-mr-2 rounded-lg p-2 text-muted-foreground active:bg-muted"
            aria-label="Закрыть"
          >
            <X className="size-5" />
          </button>
        </div>

        <div className="flex min-h-0 flex-col gap-3 overflow-y-auto px-4 pt-2">
          <div className="flex items-end gap-2">
            <textarea
              autoFocus
              rows={2}
              value={draft.title}
              onChange={(e) => set("title", e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void submit();
                }
              }}
              enterKeyHint="done"
              placeholder="Что нужно сделать?"
              className="min-w-0 flex-1 resize-none rounded-xl border border-input bg-transparent px-3 py-2.5 text-base outline-none placeholder:text-muted-foreground focus-visible:border-ring"
            />
            <button
              onClick={() => void submit()}
              disabled={!draft.title.trim() || saving}
              aria-label="Создать задачу"
              className="mb-0.5 rounded-xl bg-primary p-2.5 text-primary-foreground transition-opacity disabled:opacity-40"
            >
              <ArrowUp className="size-5" />
            </button>
          </div>

          <div className="flex flex-wrap gap-1.5 pb-1">
            <Popover>
              <PopoverTrigger render={<button className={cn(CHIP, draft.status_id ? CHIP_SET : CHIP_EMPTY)} />}>
                <span
                  className="size-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: status?.color ?? "#94a3b8" }}
                />
                <span className="truncate">{status?.name ?? "Статус"}</span>
              </PopoverTrigger>
              <PopoverContent align="start" className={MENU_POPOVER}>
                <StatusMenu value={draft.status_id ?? status?.id ?? null} onChange={(id) => set("status_id", id)} />
              </PopoverContent>
            </Popover>

            <Popover>
              <PopoverTrigger
                render={<button className={cn(CHIP, draft.priority !== "none" ? CHIP_SET : CHIP_EMPTY)} />}
              >
                <Flag className="size-3.5 shrink-0" />
                <span className="truncate">
                  {draft.priority !== "none" ? PRIORITY_LABELS[draft.priority].label : "Приоритет"}
                </span>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-44 p-1">
                <PriorityMenu value={draft.priority} onChange={(p) => set("priority", p)} />
              </PopoverContent>
            </Popover>

            <DuePicker
              date={draft.due_date}
              time={draft.due_time}
              triggerClassName={cn(CHIP, draft.due_date ? CHIP_SET : CHIP_EMPTY)}
              onCommit={({ due_date, due_time }) =>
                setDraft((d) => ({ ...d, due_date, due_time }))
              }
            >
              <Calendar className="size-3.5 shrink-0" />
              <span className="truncate">{due ?? "Срок"}</span>
            </DuePicker>

            <Popover>
              <PopoverTrigger
                render={<button className={cn(CHIP, draft.estimated_minutes != null ? CHIP_SET : CHIP_EMPTY)} />}
              >
                <Clock className="size-3.5 shrink-0" />
                <span className="truncate">
                  {draft.estimated_minutes != null ? formatEstimate(draft.estimated_minutes) : "Оценка"}
                </span>
              </PopoverTrigger>
              <PopoverContent align="start" className={ESTIMATE_POPOVER}>
                <EstimateForm
                  value={draft.estimated_minutes}
                  onChange={(m) => set("estimated_minutes", m)}
                />
              </PopoverContent>
            </Popover>

            <Popover>
              <PopoverTrigger
                render={<button className={cn(CHIP, draftAssignees.length > 0 ? CHIP_SET : CHIP_EMPTY)} />}
              >
                <Users className="size-3.5 shrink-0" />
                <span className="truncate">
                  {draftAssignees.length === 0
                    ? "Исполнители"
                    : draftAssignees.length === 1
                      ? draftAssignees[0].name || draftAssignees[0].email
                      : `${draftAssignees[0].name || draftAssignees[0].email} +${draftAssignees.length - 1}`}
                </span>
              </PopoverTrigger>
              <PopoverContent align="start" className={MENU_POPOVER}>
                <AssigneesMenu
                  value={draft.assignee_ids}
                  projectIds={draft.project_ids}
                  onChange={(ids) => set("assignee_ids", ids)}
                />
              </PopoverContent>
            </Popover>

            <Popover>
              <PopoverTrigger
                render={<button className={cn(CHIP, draftProjects.length > 0 ? CHIP_SET : CHIP_EMPTY)} />}
              >
                <Folder className="size-3.5 shrink-0" />
                <span className="truncate">
                  {draftProjects.length === 0
                    ? "Проект"
                    : draftProjects.length === 1
                      ? draftProjects[0].name
                      : `${draftProjects[0].name} +${draftProjects.length - 1}`}
                </span>
              </PopoverTrigger>
              <PopoverContent align="start" className={MENU_POPOVER}>
                <ProjectsMenu value={draft.project_ids} onChange={(ids) => set("project_ids", ids)} />
              </PopoverContent>
            </Popover>

            <Popover>
              <PopoverTrigger
                render={<button className={cn(CHIP, draftTags.length > 0 ? CHIP_SET : CHIP_EMPTY)} />}
              >
                {draftTags.length > 0 ? (
                  <span
                    className="size-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: draftTags[0].color }}
                  />
                ) : (
                  <Tag className="size-3.5 shrink-0" />
                )}
                <span className="truncate">
                  {draftTags.length === 0
                    ? "Теги"
                    : draftTags.length === 1
                      ? draftTags[0].name
                      : `${draftTags[0].name} +${draftTags.length - 1}`}
                </span>
              </PopoverTrigger>
              <PopoverContent align="start" className={MENU_POPOVER}>
                <TagsMenu value={draft.tag_ids} onChange={(ids) => set("tag_ids", ids)} />
              </PopoverContent>
            </Popover>
          </div>

          {draft.project_ids.length === 0 && (
            <p className="-mt-2 flex items-center gap-1.5 pb-1 text-xs text-muted-foreground">
              <CircleDashed className="size-3.5 shrink-0" />
              Без проекта задача попадёт в личный список
            </p>
          )}

          {error && <p className="pb-1 text-sm text-destructive">{error}</p>}
        </div>
      </SheetContent>
    </Sheet>
  );
}
