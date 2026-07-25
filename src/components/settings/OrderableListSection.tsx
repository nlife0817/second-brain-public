"use client";

import { useState, useCallback } from "react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ColorPickerButton } from "@/components/ui/color-picker";
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

export interface OrderableItem {
  id: string;
  name: string;
  color?: string;
  position: number;
}

interface Props<T extends OrderableItem> {
  items: T[];
  onCreate: (name: string, color?: string) => Promise<unknown>;
  onUpdate: (id: string, updates: Partial<T>) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  hasColor?: boolean;
  emptyText?: string;
  addPlaceholder?: string;
}

interface SortableRowProps {
  item: OrderableItem;
  hasColor: boolean;
  editingId: string | null;
  editName: string;
  editColor: string;
  onStartEdit: (item: OrderableItem) => void;
  onEditNameChange: (v: string) => void;
  onEditColorChange: (v: string) => void;
  onEditSave: (id: string) => void;
  onEditCancel: () => void;
  onDelete: (id: string) => void;
}

function SortableRow({
  item,
  hasColor,
  editingId,
  editName,
  editColor,
  onStartEdit,
  onEditNameChange,
  onEditColorChange,
  onEditSave,
  onEditCancel,
  onDelete,
}: SortableRowProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.id });

  const style = { transform: CSS.Transform.toString(transform), transition };
  const isEditing = editingId === item.id;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "group flex items-center gap-2 rounded-lg px-1.5 py-1 transition-colors",
        isDragging ? "z-50 bg-slate-100 shadow-md opacity-80 ring-1 ring-slate-200" : "hover:bg-slate-50",
      )}
    >
      {/* drag handle — always visible */}
      <button
        type="button"
        className={cn(
          "shrink-0 touch-none text-slate-300 transition-colors hover:text-slate-500",
          isEditing ? "cursor-default opacity-30" : "cursor-grab active:cursor-grabbing",
        )}
        aria-label="Перетащить"
        {...(isEditing ? {} : { ...attributes, ...listeners })}
      >
        <GripVertical className="size-3.5" />
      </button>

      {isEditing ? (
        /* ---------- edit mode ---------- */
        <>
          {hasColor && (
            <ColorPickerButton value={editColor} onChange={onEditColorChange} size="sm" />
          )}
          <Input
            value={editName}
            onChange={(e) => onEditNameChange(e.target.value)}
            className="h-7 flex-1 border-slate-200 text-sm focus:border-slate-400"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter") onEditSave(item.id);
              if (e.key === "Escape") onEditCancel();
            }}
          />
          <button
            type="button"
            onClick={() => onEditSave(item.id)}
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
        /* ---------- view mode ---------- */
        <>
          {hasColor && item.color && (
            <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: item.color }} />
          )}
          <span className="flex-1 truncate text-sm text-slate-700">{item.name}</span>
          <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
            <button
              type="button"
              onClick={() => onStartEdit(item)}
              className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
              aria-label="Редактировать"
            >
              <Pencil className="size-3" />
            </button>
            <button
              type="button"
              onClick={() => onDelete(item.id)}
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

export function OrderableListSection<T extends OrderableItem>({
  items,
  onCreate,
  onUpdate,
  onDelete,
  hasColor = false,
  emptyText = "Пока пусто",
  addPlaceholder = "Название...",
}: Props<T>) {
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState("#3b82f6");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editColor, setEditColor] = useState("#3b82f6");

  const sorted = [...items].sort((a, b) => a.position - b.position);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  const handleCreate = useCallback(async () => {
    if (!newName.trim()) return;
    await onCreate(newName.trim(), hasColor ? newColor : undefined);
    setNewName("");
  }, [newName, newColor, hasColor, onCreate]);

  const handleUpdate = useCallback(async (id: string) => {
    if (!editName.trim()) return;
    const updates: Partial<OrderableItem> = { name: editName.trim() };
    if (hasColor) updates.color = editColor;
    await onUpdate(id, updates as Partial<T>);
    setEditingId(null);
  }, [editName, editColor, hasColor, onUpdate]);

  const handleDelete = useCallback(async (id: string) => {
    if (!confirm("Удалить?")) return;
    await onDelete(id);
  }, [onDelete]);

  const handleDragEnd = useCallback(async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = sorted.findIndex((item) => item.id === active.id);
    const newIndex = sorted.findIndex((item) => item.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    const reordered = arrayMove(sorted, oldIndex, newIndex);
    await Promise.all(
      reordered
        .map((item, idx) => ({ item, idx }))
        .filter(({ item, idx }) => item.position !== idx)
        .map(({ item, idx }) => onUpdate(item.id, { position: idx } as Partial<T>)),
    );
  }, [sorted, onUpdate]);

  return (
    <div className="space-y-1">
      {/* list */}
      {sorted.length > 0 ? (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={sorted.map((item) => item.id)} strategy={verticalListSortingStrategy}>
            <div className="flex flex-col gap-0.5">
              {sorted.map((item) => (
                <SortableRow
                  key={item.id}
                  item={item}
                  hasColor={hasColor}
                  editingId={editingId}
                  editName={editName}
                  editColor={editColor}
                  onStartEdit={(i) => {
                    setEditingId(i.id);
                    setEditName(i.name);
                    setEditColor(i.color ?? "#3b82f6");
                  }}
                  onEditNameChange={setEditName}
                  onEditColorChange={setEditColor}
                  onEditSave={handleUpdate}
                  onEditCancel={() => setEditingId(null)}
                  onDelete={handleDelete}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      ) : (
        <p className="py-1.5 text-xs text-slate-400">{emptyText}</p>
      )}

      {/* add new */}
      <div className="flex items-center gap-2 pt-1">
        {hasColor && (
          <ColorPickerButton value={newColor} onChange={setNewColor} size="sm" />
        )}
        <Input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder={addPlaceholder}
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
