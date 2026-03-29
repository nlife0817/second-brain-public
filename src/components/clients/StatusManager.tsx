"use client";

import { useState, useCallback } from "react";
import { useBrainStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Plus, X } from "lucide-react";

const PRESET_COLORS = [
  "#6b7280", "#ef4444", "#f97316", "#eab308", "#22c55e",
  "#06b6d4", "#3b82f6", "#8b5cf6", "#ec4899", "#14b8a6",
];

interface StatusManagerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function StatusManager({ open, onOpenChange }: StatusManagerProps) {
  const clientStatuses = useBrainStore((s) => s.clientStatuses);
  const createStatus = useBrainStore((s) => s.createClientStatus);
  const updateStatus = useBrainStore((s) => s.updateClientStatus);
  const deleteStatus = useBrainStore((s) => s.deleteClientStatus);

  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState("#3b82f6");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editColor, setEditColor] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const handleCreate = useCallback(async () => {
    const name = newName.trim();
    if (!name) return;
    await createStatus(name, newColor);
    setNewName("");
  }, [newName, newColor, createStatus]);

  const handleUpdate = useCallback(async (id: string) => {
    const name = editName.trim();
    if (!name) return;
    await updateStatus(id, { name, color: editColor });
    setEditingId(null);
  }, [editName, editColor, updateStatus]);

  const handleDelete = useCallback(async (id: string) => {
    await deleteStatus(id);
    setConfirmDeleteId(null);
  }, [deleteStatus]);

  const startEdit = (id: string, name: string, color: string) => {
    setEditingId(id);
    setEditName(name);
    setEditColor(color);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-slate-200 bg-white sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-slate-900">Статусы клиентов</DialogTitle>
          <DialogDescription className="text-slate-500">
            Создавайте и управляйте статусами для клиентов
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          {/* Existing statuses */}
          {clientStatuses.length > 0 && (
            <div className="flex flex-col gap-1.5">
              {clientStatuses.map((s) => (
                <div key={s.id} className="group flex items-center gap-2 rounded-lg border border-slate-100 px-3 py-2">
                  {editingId === s.id ? (
                    <>
                      <div className="flex gap-1">
                        {PRESET_COLORS.map((c) => (
                          <button
                            key={c}
                            onClick={() => setEditColor(c)}
                            className={cn(
                              "size-5 rounded-full border-2 transition-all",
                              editColor === c ? "border-slate-900 scale-110" : "border-transparent hover:border-slate-300"
                            )}
                            style={{ backgroundColor: c }}
                          />
                        ))}
                      </div>
                      <Input
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        className="h-7 flex-1 border-slate-200 text-sm"
                        onKeyDown={(e) => {
                          if (e.key === "Enter") handleUpdate(s.id);
                          if (e.key === "Escape") setEditingId(null);
                        }}
                        autoFocus
                      />
                      <Button size="sm" variant="ghost" onClick={() => handleUpdate(s.id)} className="h-7 px-2 text-xs">
                        OK
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setEditingId(null)} className="h-7 px-2 text-xs text-slate-400">
                        Отмена
                      </Button>
                    </>
                  ) : (
                    <>
                      <span className="size-3 shrink-0 rounded-full" style={{ backgroundColor: s.color }} />
                      <span
                        className="flex-1 cursor-pointer text-sm text-slate-700 hover:text-slate-900"
                        onClick={() => startEdit(s.id, s.name, s.color)}
                      >
                        {s.name}
                      </span>
                      {confirmDeleteId === s.id ? (
                        <div className="flex items-center gap-1 text-xs">
                          <span className="text-slate-400">Удалить?</span>
                          <button onClick={() => handleDelete(s.id)} className="font-medium text-red-500 hover:text-red-700">Да</button>
                          <button onClick={() => setConfirmDeleteId(null)} className="text-slate-400 hover:text-slate-600">Нет</button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setConfirmDeleteId(s.id)}
                          className="opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          <X className="size-3.5 text-slate-400 hover:text-red-500" />
                        </button>
                      )}
                    </>
                  )}
                </div>
              ))}
            </div>
          )}

          {clientStatuses.length > 0 && <Separator className="bg-slate-100" />}

          {/* Add new status */}
          <div className="flex flex-col gap-2">
            <span className="text-xs font-medium text-slate-500">Новый статус</span>
            <div className="flex flex-wrap gap-1.5">
              {PRESET_COLORS.map((c) => (
                <button
                  key={c}
                  onClick={() => setNewColor(c)}
                  className={cn(
                    "size-6 rounded-full border-2 transition-all",
                    newColor === c ? "border-slate-900 scale-110" : "border-transparent hover:border-slate-300"
                  )}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
            <div className="flex gap-2">
              <Input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Название статуса..."
                className="flex-1 border-slate-200 text-sm"
                onKeyDown={(e) => { if (e.key === "Enter") handleCreate(); }}
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
        </div>
      </DialogContent>
    </Dialog>
  );
}
