"use client";

import { useState, useRef, useCallback } from "react";
import { useBrainStore } from "@/lib/store";
import { Item } from "@/types";
import { cn } from "@/lib/utils";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Plus, X, Unlink } from "lucide-react";

interface SubtaskListProps {
  parentId: string;
  subtasks: Item[];
}

export function SubtaskList({ parentId, subtasks }: SubtaskListProps) {
  const { createItem, updateItem, deleteItem } = useBrainStore();
  const detachSubtask = useBrainStore((s) => s.detachSubtask);

  const [newTitle, setNewTitle] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [isAdding, setIsAdding] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const doneCount = subtasks.filter((s) => s.status === "done").length;
  const totalCount = subtasks.length;
  const progress = totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 0;

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

      {/* Subtask list */}
      {subtasks.length > 0 && (
        <div className="space-y-0.5">
          {subtasks.map((subtask) => (
            <div
              key={subtask.id}
              className="group/subtask flex items-center gap-2 rounded-md px-1 py-1 transition-colors hover:bg-slate-50"
            >
              <Checkbox
                checked={subtask.status === "done"}
                onCheckedChange={() => handleToggle(subtask)}
                className="shrink-0"
              />

              {editingId === subtask.id ? (
                <input
                  autoFocus
                  value={editingTitle}
                  onChange={(e) => setEditingTitle(e.target.value)}
                  onBlur={() => handleEditSave(subtask.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleEditSave(subtask.id);
                    if (e.key === "Escape") {
                      setEditingId(null);
                      setEditingTitle("");
                    }
                  }}
                  className="min-w-0 flex-1 bg-transparent text-sm text-slate-900 outline-none"
                />
              ) : (
                <span
                  onClick={() => handleEditStart(subtask)}
                  className={cn(
                    "min-w-0 flex-1 cursor-text truncate text-sm text-slate-900 transition-colors",
                    subtask.status === "done" &&
                      "text-slate-400 line-through"
                  )}
                >
                  {subtask.title}
                </span>
              )}

              {/* Detach button */}
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      className="shrink-0 opacity-0 transition-opacity group-hover/subtask:opacity-100"
                      onClick={() => handleDetach(subtask.id)}
                    />
                  }
                >
                  <Unlink className="size-3 text-slate-400" />
                </TooltipTrigger>
                <TooltipContent side="top">
                  <p>Открепить подзадачу</p>
                </TooltipContent>
              </Tooltip>

              {/* Delete button */}
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      className="shrink-0 opacity-0 transition-opacity group-hover/subtask:opacity-100"
                      onClick={() => handleDelete(subtask.id)}
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
          ))}
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
            className="min-w-0 flex-1 bg-transparent text-sm text-slate-900 placeholder:text-slate-400 outline-none"
          />
        </div>
      ) : (
        <button
          onClick={() => setIsAdding(true)}
          className="flex w-full items-center gap-2 rounded-md px-1 py-1 text-sm text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-900"
        >
          <Plus className="size-4" />
          <span>Добавить подзадачу</span>
        </button>
      )}
    </div>
  );
}
