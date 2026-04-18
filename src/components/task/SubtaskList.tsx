"use client";

import { useState, useRef, useCallback } from "react";
import { useBrainStore } from "@/lib/store";
import {
  Item,
  ItemStatus,
  ItemPriority,
  STATUS_CONFIG,
  PRIORITY_CONFIG,
} from "@/types";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { ru } from "date-fns/locale";

import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Plus, X, Unlink, CalendarIcon, ExternalLink } from "lucide-react";

/* ------------------------------------------------------------------ */
/*  Priority dot color helper                                          */
/* ------------------------------------------------------------------ */

const PRIORITY_DOT: Record<ItemPriority, string> = {
  urgent: "bg-red-500",
  high: "bg-orange-500",
  medium: "bg-yellow-500",
  low: "bg-blue-500",
  none: "bg-gray-400",
};

/* ------------------------------------------------------------------ */
/*  Statuses & priorities we allow in the subtask selects              */
/* ------------------------------------------------------------------ */

const SUBTASK_STATUSES: ItemStatus[] = [
  "inbox",
  "todo",
  "in_progress",
  "review",
  "done",
];

const SUBTASK_PRIORITIES: ItemPriority[] = [
  "urgent",
  "high",
  "medium",
  "low",
  "none",
];

/* ------------------------------------------------------------------ */
/*  Props                                                              */
/* ------------------------------------------------------------------ */

interface SubtaskListProps {
  parentId: string;
  subtasks: Item[];
}

/* ------------------------------------------------------------------ */
/*  SubtaskList                                                        */
/* ------------------------------------------------------------------ */

export function SubtaskList({ parentId, subtasks }: SubtaskListProps) {
  const createItem = useBrainStore((s) => s.createItem);
  const updateItem = useBrainStore((s) => s.updateItem);
  const deleteItem = useBrainStore((s) => s.deleteItem);
  const detachSubtask = useBrainStore((s) => s.detachSubtask);
  const openDetail = useBrainStore((s) => s.openDetail);

  const [newTitle, setNewTitle] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [isAdding, setIsAdding] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const doneCount = subtasks.filter((s) => s.status === "done").length;
  const totalCount = subtasks.length;
  const progress =
    totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 0;

  /* ---- handlers ---- */

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
        status: subtask.status === "done" ? "todo" : "done",
      });
    },
    [updateItem]
  );

  const handleDelete = useCallback(
    async (id: string) => {
      await deleteItem(id);
    },
    [deleteItem]
  );

  const handleDetach = useCallback(
    async (subtaskId: string) => {
      await detachSubtask(subtaskId);
    },
    [detachSubtask]
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

  const handleStatusChange = useCallback(
    async (id: string, status: ItemStatus) => {
      await updateItem(id, { status });
    },
    [updateItem]
  );

  const handlePriorityChange = useCallback(
    async (id: string, priority: ItemPriority) => {
      await updateItem(id, { priority });
    },
    [updateItem]
  );

  const handleDateChange = useCallback(
    async (id: string, date: Date | undefined) => {
      await updateItem(id, {
        due_date: date ? format(date, "yyyy-MM-dd") : null,
      });
    },
    [updateItem]
  );

  /* ---- render ---- */

  return (
    <div className="space-y-3">
      {/* Progress header */}
      {totalCount > 0 && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500">
              Подзадачи
            </span>
            <span className="text-xs tabular-nums text-slate-500">
              {doneCount}/{totalCount}
            </span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
            <div
              className={cn(
                "h-full rounded-full transition-all duration-300 ease-out",
                progress === 100
                  ? "bg-emerald-500"
                  : progress > 0
                    ? "bg-primary"
                    : "bg-transparent"
              )}
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      )}

      {/* Subtask table */}
      {subtasks.length > 0 && (
        <div className="w-full overflow-x-auto">
          <table className="w-full border-collapse">
            {/* Column header */}
            <thead>
              <tr className="border-b border-slate-100">
                <th className="w-7 pb-1" />
                <th className="pb-1 text-left text-[10px] font-medium uppercase tracking-wider text-slate-400">
                  Название
                </th>
                <th className="hidden w-[100px] pb-1 text-left text-[10px] font-medium uppercase tracking-wider text-slate-400 sm:table-cell">
                  Статус
                </th>
                <th className="hidden w-[90px] pb-1 text-left text-[10px] font-medium uppercase tracking-wider text-slate-400 sm:table-cell">
                  Приоритет
                </th>
                <th className="hidden w-[86px] pb-1 text-left text-[10px] font-medium uppercase tracking-wider text-slate-400 md:table-cell">
                  Срок
                </th>
                <th className="w-14 pb-1" />
              </tr>
            </thead>

            <tbody>
              {subtasks.map((subtask) => (
                <SubtaskRow
                  key={subtask.id}
                  subtask={subtask}
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
                  onStatusChange={handleStatusChange}
                  onPriorityChange={handlePriorityChange}
                  onDateChange={handleDateChange}
                  onDetach={handleDetach}
                  onDelete={handleDelete}
                  onOpen={openDetail}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Add subtask */}
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
              if (!newTitle.trim()) {
                setIsAdding(false);
              }
            }}
            placeholder="Название подзадачи..."
            className="min-w-0 flex-1 bg-transparent text-xs text-slate-900 placeholder:text-slate-400 outline-none"
          />
        </div>
      ) : (
        <button
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

/* ------------------------------------------------------------------ */
/*  SubtaskRow (extracted for clarity)                                 */
/* ------------------------------------------------------------------ */

interface SubtaskRowProps {
  subtask: Item;
  isEditing: boolean;
  editingTitle: string;
  onEditTitleChange: (v: string) => void;
  onEditStart: (s: Item) => void;
  onEditSave: (id: string) => void;
  onEditCancel: () => void;
  onToggle: (s: Item) => void;
  onStatusChange: (id: string, status: ItemStatus) => void;
  onPriorityChange: (id: string, priority: ItemPriority) => void;
  onDateChange: (id: string, date: Date | undefined) => void;
  onDetach: (id: string) => void;
  onDelete: (id: string) => void;
  onOpen: (id: string) => void;
}

function SubtaskRow({
  subtask,
  isEditing,
  editingTitle,
  onEditTitleChange,
  onEditStart,
  onEditSave,
  onEditCancel,
  onToggle,
  onStatusChange,
  onPriorityChange,
  onDateChange,
  onDetach,
  onDelete,
  onOpen,
}: SubtaskRowProps) {
  const [dateOpen, setDateOpen] = useState(false);
  const isDone = subtask.status === "done";
  const parsedDate = subtask.due_date ? new Date(subtask.due_date) : undefined;

  const handleDateSelect = useCallback((date: Date | undefined) => {
    onDateChange(subtask.id, date);
    setDateOpen(false);
  }, [onDateChange, subtask.id]);

  const handleClearDate = useCallback(() => {
    onDateChange(subtask.id, undefined);
    setDateOpen(false);
  }, [onDateChange, subtask.id]);

  return (
    <tr className="group/row border-b border-slate-50 last:border-b-0 hover:bg-slate-50/60">
      {/* Checkbox */}
      <td className="py-0.5 pl-1 align-middle">
        <Checkbox
          checked={isDone}
          onCheckedChange={() => onToggle(subtask)}
          className="shrink-0"
        />
      </td>

      {/* Title */}
      <td className="py-0.5 pr-2 align-middle">
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
          <span
            onClick={() => onEditStart(subtask)}
            className={cn(
              "block h-7 cursor-text truncate leading-7 text-xs text-slate-900",
              isDone && "text-slate-400 line-through"
            )}
          >
            {subtask.title}
          </span>
        )}
      </td>

      {/* Status */}
      <td className="hidden py-0.5 pr-1 align-middle sm:table-cell">
        <Select
          value={subtask.status}
          onValueChange={(v) => onStatusChange(subtask.id, v as ItemStatus)}
        >
          <SelectTrigger
            size="sm"
            className="h-6 w-full border-0 bg-transparent px-1.5 text-[11px] shadow-none hover:bg-slate-100"
          >
            <SelectValue>
              <span
                className={cn(
                  "inline-block rounded px-1.5 py-0.5 text-[11px] font-medium leading-none",
                  STATUS_CONFIG[subtask.status].color
                )}
              >
                {STATUS_CONFIG[subtask.status].label}
              </span>
            </SelectValue>
          </SelectTrigger>
          <SelectContent className="border-slate-200 bg-white">
            {SUBTASK_STATUSES.map((key) => (
              <SelectItem key={key} value={key}>
                <span
                  className={cn(
                    "inline-block rounded px-1.5 py-0.5 text-[11px] font-medium leading-none",
                    STATUS_CONFIG[key].color
                  )}
                >
                  {STATUS_CONFIG[key].label}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </td>

      {/* Priority */}
      <td className="hidden py-0.5 pr-1 align-middle sm:table-cell">
        <Select
          value={subtask.priority}
          onValueChange={(v) =>
            onPriorityChange(subtask.id, v as ItemPriority)
          }
        >
          <SelectTrigger
            size="sm"
            className="h-6 w-full border-0 bg-transparent px-1.5 text-[11px] shadow-none hover:bg-slate-100"
          >
            <SelectValue>
              <span className="inline-flex items-center gap-1.5 text-[11px]">
                <span
                  className={cn(
                    "inline-block size-2 shrink-0 rounded-full",
                    PRIORITY_DOT[subtask.priority]
                  )}
                />
                <span className={PRIORITY_CONFIG[subtask.priority].color}>
                  {PRIORITY_CONFIG[subtask.priority].label}
                </span>
              </span>
            </SelectValue>
          </SelectTrigger>
          <SelectContent className="border-slate-200 bg-white">
            {SUBTASK_PRIORITIES.map((key) => (
              <SelectItem key={key} value={key}>
                <span className="inline-flex items-center gap-1.5">
                  <span
                    className={cn(
                      "inline-block size-2 shrink-0 rounded-full",
                      PRIORITY_DOT[key]
                    )}
                  />
                  <span className={PRIORITY_CONFIG[key].color}>
                    {PRIORITY_CONFIG[key].label}
                  </span>
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </td>

      {/* Due date */}
      <td className="hidden py-0.5 pr-1 align-middle md:table-cell">
        <Popover open={dateOpen} onOpenChange={setDateOpen}>
          <PopoverTrigger
            render={
              <button
                className={cn(
                  "inline-flex h-6 w-full items-center gap-1 rounded px-1.5 text-[11px] text-slate-600 transition-colors hover:bg-slate-100",
                  !parsedDate && "text-slate-400"
                )}
                type="button"
              />
            }
          >
            <CalendarIcon className="size-3 shrink-0 text-slate-400" />
            <span className="truncate">
              {parsedDate
                ? format(parsedDate, "d MMM", { locale: ru })
                : "\u2014"}
            </span>
          </PopoverTrigger>
          <PopoverContent
            align="start"
            className="w-auto border-slate-200 bg-white p-0"
          >
            <Calendar
              mode="single"
              selected={parsedDate}
              onSelect={handleDateSelect}
              locale={ru}
            />
            {parsedDate && (
              <div className="border-t border-slate-200 px-3 py-2">
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full text-xs text-slate-500 hover:text-slate-900"
                  onClick={handleClearDate}
                >
                  Убрать срок
                </Button>
              </div>
            )}
          </PopoverContent>
        </Popover>
      </td>

      {/* Actions */}
      <td className="py-0.5 pr-1 align-middle">
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
            <TooltipContent side="top">
              <p>Открыть подзадачу</p>
            </TooltipContent>
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
            <TooltipContent side="top">
              <p>Открепить подзадачу</p>
            </TooltipContent>
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
            <TooltipContent side="top">
              <p>Удалить подзадачу</p>
            </TooltipContent>
          </Tooltip>
        </div>
      </td>
    </tr>
  );
}
