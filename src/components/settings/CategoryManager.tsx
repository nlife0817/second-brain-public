"use client";

import { useState, useCallback } from "react";
import { useBrainStore } from "@/lib/store";
import { getIcon, CATEGORY_ICON_OPTIONS, ICON_MAP } from "@/lib/icon-map";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
import { Pencil, Trash2, Plus, Check, ChevronUp, ChevronDown } from "lucide-react";

const PRESET_COLORS = [
  "#ef4444",
  "#f97316",
  "#eab308",
  "#22c55e",
  "#06b6d4",
  "#3b82f6",
  "#8b5cf6",
  "#ec4899",
  "#6b7280",
  "#14b8a6",
];

interface CategoryManagerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/* ------------------------------------------------------------------ */
/*  Icon Picker                                                       */
/* ------------------------------------------------------------------ */

function IconPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (icon: string) => void;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const SelectedIcon = ICON_MAP[value] ?? ICON_MAP["Folder"];

  return (
    <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
      <PopoverTrigger
        className={cn(
          "flex size-8 shrink-0 items-center justify-center rounded-lg border border-slate-200 transition-colors hover:bg-slate-50",
          pickerOpen && "border-ring ring-2 ring-ring/30"
        )}
      >
        <SelectedIcon className="size-4 text-slate-600" />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-56 p-2">
        <ScrollArea className="max-h-48">
          <div className="grid grid-cols-5 gap-1">
            {CATEGORY_ICON_OPTIONS.map((name) => {
              const Icon = getIcon(name);
              const isActive = name === value;
              return (
                <button
                  key={name}
                  type="button"
                  onClick={() => {
                    onChange(name);
                    setPickerOpen(false);
                  }}
                  className={cn(
                    "flex size-8 items-center justify-center rounded-md transition-colors",
                    isActive
                      ? "bg-primary/10 text-primary ring-2 ring-primary/40"
                      : "text-slate-500 hover:bg-slate-100 hover:text-slate-700"
                  )}
                  title={name}
                >
                  <Icon className="size-4" />
                </button>
              );
            })}
          </div>
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}

/* ------------------------------------------------------------------ */
/*  Color Picker (preset grid)                                        */
/* ------------------------------------------------------------------ */

function ColorGrid({
  value,
  onChange,
  size = "md",
}: {
  value: string;
  onChange: (color: string) => void;
  size?: "sm" | "md";
}) {
  const dotSize = size === "sm" ? "size-5" : "size-6";
  return (
    <div className="flex flex-wrap gap-1.5">
      {PRESET_COLORS.map((c) => (
        <button
          key={c}
          type="button"
          onClick={() => onChange(c)}
          className={cn(
            dotSize,
            "rounded-full border-2 transition-all",
            value === c
              ? "border-slate-900 scale-110"
              : "border-transparent hover:border-slate-300"
          )}
          style={{ backgroundColor: c }}
        />
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Category Manager Dialog                                           */
/* ------------------------------------------------------------------ */

export function CategoryManager({ open, onOpenChange }: CategoryManagerProps) {
  const categories = useBrainStore((s) => s.categories);
  const createCategory = useBrainStore((s) => s.createCategory);
  const updateCategory = useBrainStore((s) => s.updateCategory);
  const deleteCategory = useBrainStore((s) => s.deleteCategory);

  /* ---- editing state ---- */
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editColor, setEditColor] = useState("");
  const [editIcon, setEditIcon] = useState("");

  /* ---- new category state ---- */
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState("#3b82f6");
  const [newIcon, setNewIcon] = useState("Folder");

  /* ---- handlers ---- */

  const startEdit = (id: string, name: string, color: string, icon: string) => {
    setEditingId(id);
    setEditName(name);
    setEditColor(color);
    setEditIcon(icon);
  };

  const cancelEdit = () => setEditingId(null);

  const handleUpdate = useCallback(
    async (id: string) => {
      const name = editName.trim();
      if (!name) return;
      await updateCategory(id, { name, color: editColor, icon: editIcon });
      setEditingId(null);
    },
    [editName, editColor, editIcon, updateCategory]
  );

  const handleDelete = useCallback(
    async (id: string) => {
      if (!confirm("Удалить эту категорию?")) return;
      await deleteCategory(id);
    },
    [deleteCategory]
  );

  const handleCreate = useCallback(async () => {
    const name = newName.trim();
    if (!name) return;
    await createCategory(name, newColor, newIcon);
    setNewName("");
  }, [newName, newColor, newIcon, createCategory]);

  /* ---- sorted categories ---- */
  const sorted = [...categories].sort((a, b) => a.position - b.position);

  const moveCategory = useCallback(
    async (index: number, direction: -1 | 1) => {
      const targetIndex = index + direction;
      if (targetIndex < 0 || targetIndex >= sorted.length) return;
      const a = sorted[index];
      const b = sorted[targetIndex];
      await updateCategory(a.id, { position: b.position });
      await updateCategory(b.id, { position: a.position });
    },
    [sorted, updateCategory]
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-slate-200 bg-white sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-slate-900">
            Управление категориями
          </DialogTitle>
        </DialogHeader>

        {/* ---------- existing categories ---------- */}
        <ScrollArea className="max-h-[50vh]">
          <div className="flex flex-col gap-1">
            {sorted.map((cat, idx) => {
              const CatIcon = getIcon(cat.icon);
              const isEditing = editingId === cat.id;

              if (isEditing) {
                return (
                  <div
                    key={cat.id}
                    className="flex flex-col gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3"
                  >
                    {/* color row */}
                    <ColorGrid
                      value={editColor}
                      onChange={setEditColor}
                      size="sm"
                    />

                    {/* name + icon row */}
                    <div className="flex items-center gap-2">
                      <IconPicker value={editIcon} onChange={setEditIcon} />
                      <Input
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        className="h-8 flex-1 border-slate-200 text-sm"
                        onKeyDown={(e) => {
                          if (e.key === "Enter") handleUpdate(cat.id);
                          if (e.key === "Escape") cancelEdit();
                        }}
                        autoFocus
                      />
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        onClick={() => handleUpdate(cat.id)}
                        className="text-green-600 hover:text-green-700"
                      >
                        <Check className="size-4" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={cancelEdit}
                        className="h-7 px-2 text-xs text-slate-400"
                      >
                        Отмена
                      </Button>
                    </div>
                  </div>
                );
              }

              return (
                <div
                  key={cat.id}
                  className="group flex items-center gap-2.5 rounded-lg px-3 py-2 transition-colors hover:bg-slate-50"
                >
                  {/* color dot */}
                  <span
                    className="size-3 shrink-0 rounded-full"
                    style={{ backgroundColor: cat.color }}
                  />
                  {/* icon */}
                  <CatIcon className="size-4 shrink-0 text-slate-400" />
                  {/* name */}
                  <span className="flex-1 truncate text-sm text-slate-700">
                    {cat.name}
                  </span>
                  {/* actions: visible on hover */}
                  <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                    <Button
                      size="icon-xs"
                      variant="ghost"
                      disabled={idx === 0}
                      onClick={() => moveCategory(idx, -1)}
                    >
                      <ChevronUp className="size-3.5 text-slate-400" />
                    </Button>
                    <Button
                      size="icon-xs"
                      variant="ghost"
                      disabled={idx === sorted.length - 1}
                      onClick={() => moveCategory(idx, 1)}
                    >
                      <ChevronDown className="size-3.5 text-slate-400" />
                    </Button>
                    <Button
                      size="icon-xs"
                      variant="ghost"
                      onClick={() =>
                        startEdit(cat.id, cat.name, cat.color, cat.icon)
                      }
                    >
                      <Pencil className="size-3.5 text-slate-400" />
                    </Button>
                    <Button
                      size="icon-xs"
                      variant="ghost"
                      onClick={() => handleDelete(cat.id)}
                    >
                      <Trash2 className="size-3.5 text-slate-400 hover:text-red-500" />
                    </Button>
                  </div>
                </div>
              );
            })}

            {sorted.length === 0 && (
              <p className="py-4 text-center text-sm text-slate-400">
                Нет категорий
              </p>
            )}
          </div>
        </ScrollArea>

        {/* ---------- separator ---------- */}
        {sorted.length > 0 && (
          <div className="border-t border-slate-100" />
        )}

        {/* ---------- add new category ---------- */}
        <div className="flex flex-col gap-2">
          <span className="text-xs font-medium text-slate-500">
            Новая категория
          </span>

          <ColorGrid value={newColor} onChange={setNewColor} />

          <div className="flex items-center gap-2">
            <IconPicker value={newIcon} onChange={setNewIcon} />
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Название категории..."
              className="flex-1 border-slate-200 text-sm"
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCreate();
              }}
            />
            <Button
              onClick={handleCreate}
              disabled={!newName.trim()}
              size="sm"
            >
              <Plus className="size-4" />
              Добавить
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
