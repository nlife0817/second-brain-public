"use client";

import { useState, useCallback } from "react";
import { useBrainStore } from "@/lib/store";
import { getIcon, CATEGORY_ICON_OPTIONS, ICON_MAP } from "@/lib/icon-map";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ColorPickerButton } from "@/components/ui/color-picker";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
import { Pencil, Trash2, Plus, Check, X, GripVertical } from "lucide-react";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

/* ------------------------------------------------------------------ */
/*  Icon Picker popover                                               */
/* ------------------------------------------------------------------ */

function IconPicker({ value, onChange }: { value: string; onChange: (icon: string) => void }) {
  const [open, setOpen] = useState(false);
  const SelectedIcon = ICON_MAP[value] ?? ICON_MAP["Folder"];

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        className={cn(
          "flex size-7 shrink-0 items-center justify-center rounded-md border border-slate-200 transition-colors hover:bg-slate-50",
          open && "border-slate-400 bg-slate-50",
        )}
        aria-label="Выбрать иконку"
      >
        <SelectedIcon className="size-3.5 text-slate-600" />
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={6} className="w-52 p-2">
        <ScrollArea className="max-h-44">
          <div className="grid grid-cols-6 gap-1">
            {CATEGORY_ICON_OPTIONS.map((name) => {
              const Icon = getIcon(name);
              return (
                <button
                  key={name}
                  type="button"
                  onClick={() => { onChange(name); setOpen(false); }}
                  className={cn(
                    "flex size-7 items-center justify-center rounded-md transition-colors",
                    name === value
                      ? "bg-violet-100 text-violet-700"
                      : "text-slate-500 hover:bg-slate-100 hover:text-slate-700",
                  )}
                  title={name}
                >
                  <Icon className="size-3.5" />
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
/*  Sortable category row                                             */
/* ------------------------------------------------------------------ */

interface SortableCatRowProps {
  cat: { id: string; name: string; color: string; icon: string; position: number };
  editingId: string | null;
  editName: string;
  editColor: string;
  editIcon: string;
  onStartEdit: (cat: SortableCatRowProps["cat"]) => void;
  onEditNameChange: (v: string) => void;
  onEditColorChange: (v: string) => void;
  onEditIconChange: (v: string) => void;
  onEditSave: (id: string) => void;
  onEditCancel: () => void;
  onDelete: (id: string) => void;
}

function SortableCatRow({
  cat,
  editingId,
  editName,
  editColor,
  editIcon,
  onStartEdit,
  onEditNameChange,
  onEditColorChange,
  onEditIconChange,
  onEditSave,
  onEditCancel,
  onDelete,
}: SortableCatRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: cat.id });
  const style = { transform: CSS.Transform.toString(transform), transition };
  const isEditing = editingId === cat.id;
  const CatIcon = getIcon(cat.icon);

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "group flex items-center gap-2 rounded-lg px-1.5 py-1 transition-colors",
        isDragging ? "z-50 bg-slate-100 shadow-md opacity-80 ring-1 ring-slate-200" : "hover:bg-slate-50",
      )}
    >
      {/* drag handle */}
      <button
        type="button"
        className={cn(
          "shrink-0 touch-none text-slate-300 transition-colors hover:text-slate-500",
          isEditing ? "cursor-default opacity-30" : "cursor-grab active:cursor-grabbing",
        )}
        {...(isEditing ? {} : { ...attributes, ...listeners })}
        aria-label="Перетащить"
      >
        <GripVertical className="size-3.5" />
      </button>

      {isEditing ? (
        <>
          <ColorPickerButton value={editColor} onChange={onEditColorChange} size="sm" />
          <IconPicker value={editIcon} onChange={onEditIconChange} />
          <Input
            value={editName}
            onChange={(e) => onEditNameChange(e.target.value)}
            className="h-7 flex-1 border-slate-200 text-sm focus:border-slate-400"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter") onEditSave(cat.id);
              if (e.key === "Escape") onEditCancel();
            }}
          />
          <button
            type="button"
            onClick={() => onEditSave(cat.id)}
            className="shrink-0 rounded p-1 text-emerald-600 hover:bg-emerald-50"
            aria-label="Сохранить"
          >
            <Check className="size-3.5" />
          </button>
          <button
            type="button"
            onClick={onEditCancel}
            className="shrink-0 rounded p-1 text-slate-400 hover:bg-slate-100"
            aria-label="Отмена"
          >
            <X className="size-3.5" />
          </button>
        </>
      ) : (
        <>
          <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: cat.color }} />
          <CatIcon className="size-3.5 shrink-0 text-slate-400" />
          <span className="flex-1 truncate text-sm text-slate-700">{cat.name}</span>
          <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
            <button
              type="button"
              onClick={() => onStartEdit(cat)}
              className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
              aria-label="Редактировать"
            >
              <Pencil className="size-3" />
            </button>
            <button
              type="button"
              onClick={() => onDelete(cat.id)}
              className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-500"
              aria-label="Удалить"
            >
              <Trash2 className="size-3" />
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  CategoriesSection — inline in settings, no dialog                */
/* ------------------------------------------------------------------ */

export function CategoriesSection() {
  const categories = useBrainStore((s) => s.categories);
  const createCategory = useBrainStore((s) => s.createCategory);
  const updateCategory = useBrainStore((s) => s.updateCategory);
  const deleteCategory = useBrainStore((s) => s.deleteCategory);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editColor, setEditColor] = useState("#3b82f6");
  const [editIcon, setEditIcon] = useState("Folder");

  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState("#3b82f6");
  const [newIcon, setNewIcon] = useState("Folder");

  const sorted = [...categories].sort((a, b) => a.position - b.position);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  const handleUpdate = useCallback(async (id: string) => {
    const name = editName.trim();
    if (!name) return;
    await updateCategory(id, { name, color: editColor, icon: editIcon });
    setEditingId(null);
  }, [editName, editColor, editIcon, updateCategory]);

  const handleDelete = useCallback(async (id: string) => {
    if (!confirm("Удалить категорию?")) return;
    await deleteCategory(id);
  }, [deleteCategory]);

  const handleCreate = useCallback(async () => {
    const name = newName.trim();
    if (!name) return;
    await createCategory(name, newColor, newIcon);
    setNewName("");
  }, [newName, newColor, newIcon, createCategory]);

  const handleDragEnd = useCallback(async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = sorted.findIndex((c) => c.id === active.id);
    const newIndex = sorted.findIndex((c) => c.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    const reordered = arrayMove(sorted, oldIndex, newIndex);
    await Promise.all(
      reordered
        .map((c, idx) => ({ c, idx }))
        .filter(({ c, idx }) => c.position !== idx)
        .map(({ c, idx }) => updateCategory(c.id, { position: idx })),
    );
  }, [sorted, updateCategory]);

  return (
    <div className="space-y-1">
      {sorted.length > 0 ? (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={sorted.map((c) => c.id)} strategy={verticalListSortingStrategy}>
            <div className="flex flex-col gap-0.5">
              {sorted.map((cat) => (
                <SortableCatRow
                  key={cat.id}
                  cat={cat}
                  editingId={editingId}
                  editName={editName}
                  editColor={editColor}
                  editIcon={editIcon}
                  onStartEdit={(c) => { setEditingId(c.id); setEditName(c.name); setEditColor(c.color); setEditIcon(c.icon); }}
                  onEditNameChange={setEditName}
                  onEditColorChange={setEditColor}
                  onEditIconChange={setEditIcon}
                  onEditSave={handleUpdate}
                  onEditCancel={() => setEditingId(null)}
                  onDelete={handleDelete}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      ) : (
        <p className="py-1.5 text-xs text-slate-400">Нет категорий</p>
      )}

      {/* add new */}
      <div className="flex items-center gap-2 pt-1">
        <ColorPickerButton value={newColor} onChange={setNewColor} size="sm" />
        <IconPicker value={newIcon} onChange={setNewIcon} />
        <Input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="Название категории..."
          className="h-7 flex-1 border-slate-200 text-sm"
          onKeyDown={(e) => { if (e.key === "Enter") handleCreate(); }}
        />
        <Button
          size="sm"
          variant="ghost"
          className="h-7 shrink-0 gap-1 px-2 text-xs text-slate-600 hover:text-slate-900"
          onClick={handleCreate}
          disabled={!newName.trim()}
        >
          <Plus className="size-3.5" />
          Добавить
        </Button>
      </div>
    </div>
  );
}

/* keep backward-compatible export so old imports don't break */
export function CategoryManager({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  if (!open) return null;
  return (
    <div>
      <CategoriesSection />
      <button type="button" onClick={() => onOpenChange(false)} className="sr-only">
        Закрыть
      </button>
    </div>
  );
}
