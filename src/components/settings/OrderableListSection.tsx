"use client";

import { useState, useCallback } from "react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Pencil, Trash2, Plus, Check, X, ChevronUp, ChevronDown } from "lucide-react";

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

  const move = useCallback(async (idx: number, dir: -1 | 1) => {
    const target = idx + dir;
    if (target < 0 || target >= sorted.length) return;
    const a = sorted[idx];
    const b = sorted[target];
    await onUpdate(a.id, { position: b.position } as Partial<T>);
    await onUpdate(b.id, { position: a.position } as Partial<T>);
  }, [sorted, onUpdate]);

  return (
    <div className="space-y-2">
      {sorted.length > 0 ? (
        <div className="flex flex-col gap-0.5">
          {sorted.map((item, idx) => (
            <div
              key={item.id}
              className="group flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-slate-50 transition-colors"
            >
              {editingId === item.id ? (
                <>
                  {hasColor && (
                    <div className="flex gap-0.5 shrink-0">
                      {PRESET_COLORS.map((c) => (
                        <button
                          key={c}
                          onClick={() => setEditColor(c)}
                          className={cn("size-4 rounded-full border transition-all", editColor === c ? "border-slate-800 scale-110" : "border-transparent")}
                          style={{ backgroundColor: c }}
                        />
                      ))}
                    </div>
                  )}
                  <Input
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    className="h-7 flex-1 text-sm"
                    autoFocus
                    onKeyDown={(e) => { if (e.key === "Enter") handleUpdate(item.id); if (e.key === "Escape") setEditingId(null); }}
                  />
                  <Button size="icon-xs" variant="ghost" onClick={() => handleUpdate(item.id)} className="text-green-600">
                    <Check className="size-3.5" />
                  </Button>
                  <Button size="icon-xs" variant="ghost" onClick={() => setEditingId(null)}>
                    <X className="size-3.5 text-slate-400" />
                  </Button>
                </>
              ) : (
                <>
                  {hasColor && item.color && (
                    <span className="size-3 rounded-full shrink-0" style={{ backgroundColor: item.color }} />
                  )}
                  <span className="flex-1 text-sm text-slate-700 truncate">{item.name}</span>
                  <div className="flex items-center gap-0 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Button size="icon-xs" variant="ghost" disabled={idx === 0} onClick={() => move(idx, -1)}>
                      <ChevronUp className="size-3.5 text-slate-400" />
                    </Button>
                    <Button size="icon-xs" variant="ghost" disabled={idx === sorted.length - 1} onClick={() => move(idx, 1)}>
                      <ChevronDown className="size-3.5 text-slate-400" />
                    </Button>
                    <Button
                      size="icon-xs"
                      variant="ghost"
                      onClick={() => { setEditingId(item.id); setEditName(item.name); setEditColor(item.color ?? "#3b82f6"); }}
                    >
                      <Pencil className="size-3.5 text-slate-400" />
                    </Button>
                    <Button size="icon-xs" variant="ghost" onClick={() => handleDelete(item.id)}>
                      <Trash2 className="size-3.5 text-slate-400 hover:text-red-500" />
                    </Button>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs text-slate-400 py-2">{emptyText}</p>
      )}

      {/* Add new */}
      <div className="flex items-center gap-2 pt-1">
        {hasColor && (
          <div className="flex gap-0.5 shrink-0">
            {PRESET_COLORS.slice(0, 5).map((c) => (
              <button
                key={c}
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
