"use client";

import { useState, useCallback } from "react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
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

const PRESET_COLORS = [
  "#ef4444", "#f97316", "#eab308", "#22c55e", "#06b6d4",
  "#3b82f6", "#8b5cf6", "#ec4899", "#6b7280", "#14b8a6",
];

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

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const isEditing = editingId === item.id;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "group flex items-center gap-2 rounded-lg px-2 py-1.5 transition-colors",
        isDragging ? "z-50 bg-slate-100 shadow-md opacity-80 ring-1 ring-slate-200" : "hover:bg-slate-50",
      )}
    >
      {isEditing ? (
        <>
          {hasColor && (
            <div className="flex gap-0.5 shrink-0 flex-wrap max-w-[120px]">
              {PRESET_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => onEditColorChange(c)}
                  className={cn(
                    "size-4 rounded-full border transition-all",
                    editColor === c ? "border-slate-800 scale-110" : "border-transparent",
                  )}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          )}
          <Input
            value={editName}
            onChange={(e) => onEditNameChange(e.target.value)}
            className="h-7 flex-1 text-sm"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter") onEditSave(item.id);
              if (e.key === "Escape") onEditCancel();
            }}
          />
          <Button size="icon-xs" variant="ghost" onClick={() => onEditSave(item.id)} className="text-green-600 shrink-0">
            <Check className="size-3.5" />
          </Button>
          <Button size="icon-xs" variant="ghost" onClick={onEditCancel} className="shrink-0">
            <X className="size-3.5 text-slate-400" />
          </Button>
        </>
      ) : (
        <>
          <button
            type="button"
            className="cursor-grab active:cursor-grabbing text-slate-300 hover:text-slate-500 shrink-0 touch-none"
            aria-label="Перетащить"
            {...attributes}
            {...listeners}
          >
            <GripVertical className="size-4" />
          </button>
          {hasColor && item.color && (
            <span className="size-3 rounded-full shrink-0" style={{ backgroundColor: item.color }} />
          )}
          <span className="flex-1 text-sm text-slate-700 truncate">{item.name}</span>
          <div className="flex items-center gap-0 opacity-0 group-hover:opacity-100 transition-opacity">
            <Button
              size="icon-xs"
              variant="ghost"
              onClick={() => onStartEdit(item)}
            >
              <Pencil className="size-3.5 text-slate-400" />
            </Button>
            <Button size="icon-xs" variant="ghost" onClick={() => onDelete(item.id)}>
              <Trash2 className="size-3.5 text-slate-400 hover:text-red-500" />
            </Button>
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
  const [editColor, setEditColor] = useState("");

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
    <div className="space-y-2">
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
                  onStartEdit={(i) => { setEditingId(i.id); setEditName(i.name); setEditColor(i.color ?? "#3b82f6"); }}
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
        <p className="text-xs text-slate-400 py-2">{emptyText}</p>
      )}

      <div className="flex items-center gap-2 pt-1">
        {hasColor && (
          <div className="flex gap-0.5 shrink-0">
            {PRESET_COLORS.slice(0, 5).map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setNewColor(c)}
                className={cn("size-4 rounded-full border transition-all", newColor === c ? "border-slate-800 scale-110" : "border-transparent")}
                style={{ backgroundColor: c }}
              />
            ))}
          </div>
        )}
        <Input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder={addPlaceholder}
          className="h-7 flex-1 text-sm"
          onKeyDown={(e) => { if (e.key === "Enter") handleCreate(); }}
        />
        <Button size="sm" className="h-7 text-xs" onClick={handleCreate} disabled={!newName.trim()}>
          <Plus className="size-3.5 mr-1" /> Добавить
        </Button>
      </div>
    </div>
  );
}
