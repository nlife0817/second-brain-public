"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { useBrainStore } from "@/lib/store";
import {
  Item,
  ItemStatus,
  ItemPriority,
  ItemStatusRow,
  STATUS_CONFIG,
  PRIORITY_CONFIG,
} from "@/types";
import { cn } from "@/lib/utils";

import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { DateTimePicker } from "@/components/ui/DateTimePicker";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { InlineSelectPopover, type InlineSelectOption } from "@/components/ui/inline-select-popover";
import {
  ArrowUpDown,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Eye,
  EyeOff,
  Plus,
  Unlink,
  X,
} from "lucide-react";

const PRIORITY_DOT: Record<ItemPriority, string> = {
  urgent: "bg-red-500",
  high: "bg-orange-500",
  medium: "bg-yellow-400",
  low: "bg-blue-500",
  none: "border border-slate-300 bg-transparent",
};

const SUBTASK_PRIORITIES: ItemPriority[] = ["urgent", "high", "medium", "low", "none"];

const STATUS_WEIGHT: Record<string, number> = {
  in_progress: 0,
  review: 1,
  todo: 2,
  inbox: 3,
  done: 4,
  archived: 5,
};

const PRIORITY_WEIGHT: Record<string, number> = {
  urgent: 0,
  high: 1,
  medium: 2,
  low: 3,
  none: 4,
};

type SubtaskSortMode = "default" | "due_date" | "priority" | "status";
type EditingField = "status" | "priority" | null;

interface SubtaskListProps {
  parentId: string;
  subtasks: Item[];
}

function statusDisplay(
  status: string,
  itemStatuses: ItemStatusRow[]
): { label: string; className?: string; color?: string; kind?: string } {
  const row = itemStatuses.find((s) => s.id === status);
  if (row) return { label: row.name, color: row.color, kind: row.kind };
  const fallback = STATUS_CONFIG[status as ItemStatus];
  return fallback
    ? { label: fallback.label, className: fallback.color }
    : { label: status, className: "bg-slate-100 text-slate-700" };
}

function isClosedSubtaskStatus(status: string, itemStatuses: ItemStatusRow[]) {
  const row = itemStatuses.find((s) => s.id === status);
  const label = (row?.name ?? STATUS_CONFIG[status as ItemStatus]?.label ?? status).toLowerCase();
  return (
    row?.kind === "done" ||
    row?.kind === "archived" ||
    status === "done" ||
    status === "archived" ||
    label.includes("готов") ||
    label.includes("архив") ||
    label.includes("не актуал")
  );
}

function PriorityDot({ priority, className }: { priority: ItemPriority; className?: string }) {
  return <span className={cn("inline-block size-2.5 rounded-full", PRIORITY_DOT[priority], className)} />;
}

export function SubtaskList({ parentId, subtasks }: SubtaskListProps) {
  const createItem = useBrainStore((s) => s.createItem);
  const updateItem = useBrainStore((s) => s.updateItem);
  const deleteItem = useBrainStore((s) => s.deleteItem);
  const detachSubtask = useBrainStore((s) => s.detachSubtask);
  const openDetail = useBrainStore((s) => s.openDetail);
  const itemStatuses = useBrainStore((s) => s.itemStatuses);

  const [newTitle, setNewTitle] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [isAdding, setIsAdding] = useState(false);
  const [sortMode, setSortMode] = useState<SubtaskSortMode>("default");
  const [hideClosed, setHideClosed] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const doneCount = subtasks.filter((s) => isClosedSubtaskStatus(s.status, itemStatuses)).length;
  const totalCount = subtasks.length;
  const progress = totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 0;

  const statusOptions = useMemo<InlineSelectOption<ItemStatus>[]>(() => {
    if (itemStatuses.length === 0) {
      return (Object.entries(STATUS_CONFIG) as [ItemStatus, (typeof STATUS_CONFIG)[ItemStatus]][])
        .map(([key, cfg]) => ({ key, label: cfg.label }));
    }
    return [...itemStatuses]
      .sort((a, b) => a.position - b.position)
      .map((status) => ({ key: status.id as ItemStatus, label: status.name }));
  }, [itemStatuses]);

  const priorityOptions = useMemo<InlineSelectOption<ItemPriority>[]>(
    () =>
      SUBTASK_PRIORITIES.map((key) => ({
        key,
        label: PRIORITY_CONFIG[key].label,
        node: (
          <span className="inline-flex items-center gap-2">
            <PriorityDot priority={key} />
            <span>{PRIORITY_CONFIG[key].label}</span>
          </span>
        ),
      })),
    []
  );

  const sortedSubtasks = useMemo(() => {
    let list = hideClosed
      ? subtasks.filter((subtask) => !isClosedSubtaskStatus(subtask.status, itemStatuses))
      : subtasks;
    if (sortMode === "default") return list;
    list = [...list];
    list.sort((a, b) => {
      switch (sortMode) {
        case "due_date": {
          const aTime = a.due_date ? new Date(a.due_date).getTime() : Infinity;
          const bTime = b.due_date ? new Date(b.due_date).getTime() : Infinity;
          return aTime - bTime;
        }
        case "priority":
          return (PRIORITY_WEIGHT[a.priority] ?? 99) - (PRIORITY_WEIGHT[b.priority] ?? 99);
        case "status":
          return (STATUS_WEIGHT[a.status] ?? 99) - (STATUS_WEIGHT[b.status] ?? 99);
        default:
          return 0;
      }
    });
    return list;
  }, [hideClosed, itemStatuses, sortMode, subtasks]);

  const visibleSubtasks = expanded ? sortedSubtasks : sortedSubtasks.slice(0, 8);
  const canCollapse = sortedSubtasks.length > 8;
  const sortLabel: Record<SubtaskSortMode, string> = {
    default: "Без сортировки",
    due_date: "По дедлайну",
    priority: "По приоритету",
    status: "По статусу",
  };

  const handleAdd = useCallback(async () => {
    const title = newTitle.trim();
    if (!title) return;
    setNewTitle("");
    await createItem({
      title,
      parent_id: parentId,
      type: "task",
      status: "todo",
      priority: "none",
      category: "other",
    });
  }, [newTitle, parentId, createItem]);

  const handleToggle = useCallback(
    async (subtask: Item) => {
      await updateItem(subtask.id, {
        status: isClosedSubtaskStatus(subtask.status, itemStatuses) ? "todo" : "done",
      });
    },
    [itemStatuses, updateItem]
  );

  const handleEditStart = useCallback((subtask: Item) => {
    setEditingId(subtask.id);
    setEditingTitle(subtask.title);
  }, []);

  const handleEditSave = useCallback(
    async (id: string) => {
      const title = editingTitle.trim();
      if (title && title !== subtasks.find((s) => s.id === id)?.title) {
        await updateItem(id, { title });
      }
      setEditingId(null);
      setEditingTitle("");
    },
    [editingTitle, subtasks, updateItem]
  );

  return (
    <div className="space-y-3">
      {totalCount > 0 && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-slate-500">Подзадачи</span>
            <div className="flex items-center gap-1.5">
              {subtasks.length > 1 && (
                <>
                  <button
                    type="button"
                    onClick={() => setHideClosed((v) => !v)}
                    className={cn(
                      "inline-flex h-6 items-center gap-1 rounded-md px-1.5 text-[10px] transition-colors",
                      hideClosed
                        ? "bg-violet-50 text-violet-700 hover:bg-violet-100"
                        : "text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                    )}
                    title={hideClosed ? "Показать закрытые" : "Скрыть готовые, архивные и неактуальные"}
                  >
                    {hideClosed ? <EyeOff className="size-3" /> : <Eye className="size-3" />}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const modes: SubtaskSortMode[] = ["default", "due_date", "priority", "status"];
                      setSortMode((current) => modes[(modes.indexOf(current) + 1) % modes.length]);
                    }}
                    className={cn(
                      "inline-flex h-6 items-center gap-1 rounded-md px-1.5 text-[10px] transition-colors",
                      sortMode !== "default"
                        ? "bg-violet-50 text-violet-700 hover:bg-violet-100"
                        : "text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                    )}
                    title={sortLabel[sortMode]}
                  >
                    <ArrowUpDown className="size-3" />
                    {sortMode !== "default" && <span>{sortLabel[sortMode]}</span>}
                  </button>
                </>
              )}
              <span className="text-xs tabular-nums text-slate-500">{doneCount}/{totalCount}</span>
            </div>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
            <div
              className={cn(
                "h-full rounded-full transition-all duration-300 ease-out",
                progress === 100 ? "bg-emerald-500" : progress > 0 ? "bg-primary" : "bg-transparent"
              )}
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      )}

      {sortedSubtasks.length > 0 && (
        <div className="w-full overflow-x-auto">
          <table className="w-full table-fixed border-collapse">
            <thead>
              <tr className="border-b border-slate-100">
                <th className="w-7 pb-1" />
                <th className="pb-1 text-left text-[10px] font-medium uppercase tracking-wider text-slate-400">
                  Название
                </th>
                <th className="hidden w-[112px] pb-1 text-left text-[10px] font-medium uppercase tracking-wider text-slate-400 sm:table-cell">
                  Статус
                </th>
                <th className="hidden w-[44px] pb-1 text-center text-[10px] font-medium uppercase tracking-wider text-slate-400 sm:table-cell">
                  P
                </th>
                <th className="hidden w-[96px] pb-1 text-left text-[10px] font-medium uppercase tracking-wider text-slate-400 md:table-cell">
                  Дедлайн
                </th>
                <th className="w-14 pb-1" />
              </tr>
            </thead>
            <tbody>
              {visibleSubtasks.map((subtask) => (
                <SubtaskRow
                  key={subtask.id}
                  subtask={subtask}
                  itemStatuses={itemStatuses}
                  statusOptions={statusOptions}
                  priorityOptions={priorityOptions}
                  isEditing={editingId === subtask.id}
                  editingTitle={editingTitle}
                  onEditTitleChange={setEditingTitle}
                  onEditStart={handleEditStart}
                  onEditSave={handleEditSave}
                  onEditCancel={() => {
                    setEditingId(null);
                    setEditingTitle("");
                  }}
                  onToggle={handleToggle}
                  onStatusChange={(id, status) => void updateItem(id, { status })}
                  onPriorityChange={(id, priority) => void updateItem(id, { priority })}
                  onDueChange={(id, next) => void updateItem(id, { due_date: next.date, due_time: next.time })}
                  onDetach={(id) => void detachSubtask(id)}
                  onDelete={(id) => void deleteItem(id)}
                  onOpen={openDetail}
                />
              ))}
            </tbody>
          </table>
          {canCollapse && (
            <div className="flex justify-center pt-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 rounded-full px-3 text-xs text-slate-500"
                onClick={() => setExpanded((v) => !v)}
              >
                {expanded ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
                {expanded ? "Свернуть" : `Показать ещё ${sortedSubtasks.length - visibleSubtasks.length}`}
              </Button>
            </div>
          )}
        </div>
      )}

      {subtasks.length > 0 && sortedSubtasks.length === 0 && (
        <div className="rounded-md border border-dashed border-slate-200 px-3 py-4 text-center text-xs text-slate-400">
          Все закрытые подзадачи скрыты
        </div>
      )}

      {isAdding ? (
        <div className="flex items-center gap-2 px-1">
          <div className="size-4 shrink-0" />
          <input
            ref={inputRef}
            autoFocus
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleAdd();
              if (e.key === "Escape") {
                setIsAdding(false);
                setNewTitle("");
              }
            }}
            onBlur={() => {
              if (!newTitle.trim()) setIsAdding(false);
            }}
            placeholder="Название подзадачи..."
            className="min-w-0 flex-1 bg-transparent text-xs text-slate-900 placeholder:text-slate-400 outline-none"
          />
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setIsAdding(true)}
          className="flex w-full items-center gap-2 rounded-md px-1 py-1 text-xs text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-900"
        >
          <Plus className="size-3.5" />
          <span>Добавить подзадачу</span>
        </button>
      )}
    </div>
  );
}

interface SubtaskRowProps {
  subtask: Item;
  itemStatuses: ItemStatusRow[];
  statusOptions: InlineSelectOption<ItemStatus>[];
  priorityOptions: InlineSelectOption<ItemPriority>[];
  isEditing: boolean;
  editingTitle: string;
  onEditTitleChange: (v: string) => void;
  onEditStart: (s: Item) => void;
  onEditSave: (id: string) => void;
  onEditCancel: () => void;
  onToggle: (s: Item) => void;
  onStatusChange: (id: string, status: ItemStatus) => void;
  onPriorityChange: (id: string, priority: ItemPriority) => void;
  onDueChange: (id: string, next: { date: string | null; time: string | null }) => void;
  onDetach: (id: string) => void;
  onDelete: (id: string) => void;
  onOpen: (id: string) => void;
}

function SubtaskRow({
  subtask,
  itemStatuses,
  statusOptions,
  priorityOptions,
  isEditing,
  editingTitle,
  onEditTitleChange,
  onEditStart,
  onEditSave,
  onEditCancel,
  onToggle,
  onStatusChange,
  onPriorityChange,
  onDueChange,
  onDetach,
  onDelete,
  onOpen,
}: SubtaskRowProps) {
  const isDone = isClosedSubtaskStatus(subtask.status, itemStatuses);
  const status = statusDisplay(subtask.status, itemStatuses);
  const [editingField, setEditingField] = useState<EditingField>(null);
  const statusRef = useRef<HTMLTableCellElement>(null);
  const priorityRef = useRef<HTMLTableCellElement>(null);

  return (
    <tr className="group/row border-b border-slate-50 last:border-b-0 hover:bg-slate-50/60">
      <td className="py-1 pl-1 align-middle">
        <Checkbox
          checked={isDone}
          onCheckedChange={() => onToggle(subtask)}
          className="shrink-0 align-middle"
        />
      </td>

      <td className="min-w-0 py-1 pr-2 align-middle">
        {isEditing ? (
          <input
            autoFocus
            value={editingTitle}
            onChange={(e) => onEditTitleChange(e.target.value)}
            onBlur={() => onEditSave(subtask.id)}
            onKeyDown={(e) => {
              if (e.key === "Enter") onEditSave(subtask.id);
              if (e.key === "Escape") onEditCancel();
            }}
            className="h-7 w-full min-w-0 bg-transparent text-xs text-slate-900 outline-none"
          />
        ) : (
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  onClick={() => onEditStart(subtask)}
                  className={cn(
                    "flex h-7 w-full min-w-0 items-center text-left text-xs text-slate-900",
                    isDone && "text-slate-400 line-through"
                  )}
                />
              }
            >
              <span className="block min-w-0 truncate">{subtask.title}</span>
            </TooltipTrigger>
            <TooltipContent side="top">
              <p>{subtask.title}</p>
            </TooltipContent>
          </Tooltip>
        )}
      </td>

      <td
        ref={statusRef}
        className="hidden cursor-pointer py-1 pr-1 align-middle sm:table-cell"
        onClick={(e) => {
          e.stopPropagation();
          setEditingField("status");
        }}
      >
        <span
          className={cn(
            "inline-flex max-w-full rounded-md px-1.5 py-0.5 text-[10px] font-medium leading-none",
            status.className
          )}
          style={status.color ? { backgroundColor: `${status.color}1A`, color: status.color } : undefined}
        >
          <span className="truncate">{status.label}</span>
        </span>
        {editingField === "status" && (
          <InlineSelectPopover
            value={subtask.status as ItemStatus}
            options={statusOptions}
            onCommit={(status) => {
              setEditingField(null);
              onStatusChange(subtask.id, status);
            }}
            onCancel={() => setEditingField(null)}
            anchorRef={statusRef}
          />
        )}
      </td>

      <td
        ref={priorityRef}
        className="hidden cursor-pointer py-1 pr-1 text-center align-middle sm:table-cell"
        onClick={(e) => {
          e.stopPropagation();
          setEditingField("priority");
        }}
      >
        <PriorityDot priority={subtask.priority} />
        {editingField === "priority" && (
          <InlineSelectPopover
            value={subtask.priority}
            options={priorityOptions}
            onCommit={(priority) => {
              setEditingField(null);
              onPriorityChange(subtask.id, priority);
            }}
            onCancel={() => setEditingField(null)}
            anchorRef={priorityRef}
          />
        )}
      </td>

      <td className="hidden py-1 pr-1 align-middle md:table-cell" onClick={(e) => e.stopPropagation()}>
        <DateTimePicker
          size="xs"
          compact
          hideCurrentYear
          highlightOverdue={!isDone}
          placeholder="--"
          value={{ date: subtask.due_date ?? null, time: subtask.due_time ?? null }}
          onChange={(next) => onDueChange(subtask.id, next)}
        />
      </td>

      <td className="py-1 pr-1 align-middle">
        <div className="flex items-center justify-end gap-0.5 opacity-0 transition-opacity group-hover/row:opacity-100">
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-xs"
                  className="size-5"
                  onClick={() => onOpen(subtask.id)}
                />
              }
            >
              <ExternalLink className="size-3 text-slate-400" />
            </TooltipTrigger>
            <TooltipContent side="top"><p>Открыть подзадачу</p></TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-xs"
                  className="size-5"
                  onClick={() => onDetach(subtask.id)}
                />
              }
            >
              <Unlink className="size-3 text-slate-400" />
            </TooltipTrigger>
            <TooltipContent side="top"><p>Открепить подзадачу</p></TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-xs"
                  className="size-5"
                  onClick={() => onDelete(subtask.id)}
                />
              }
            >
              <X className="size-3 text-slate-400" />
            </TooltipTrigger>
            <TooltipContent side="top"><p>Удалить подзадачу</p></TooltipContent>
          </Tooltip>
        </div>
      </td>
    </tr>
  );
}
