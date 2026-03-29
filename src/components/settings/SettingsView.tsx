"use client";

import { useState, useEffect, useCallback } from "react";
import { useBrainStore } from "@/lib/store";
import type { RelationType } from "@/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import {
  Plus,
  Trash2,
  Pencil,
  Check,
  X,
  Link,
  Palette,
  GripVertical,
} from "lucide-react";

const PRESET_COLORS = [
  "#6b7280", "#ef4444", "#f97316", "#eab308", "#22c55e",
  "#06b6d4", "#3b82f6", "#8b5cf6", "#ec4899", "#14b8a6",
];

function RelationTypeRow({
  rt,
  onUpdate,
  onDelete,
}: {
  rt: RelationType;
  onUpdate: (id: string, updates: Partial<RelationType>) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(rt.name);
  const [color, setColor] = useState(rt.color);
  const [showColors, setShowColors] = useState(false);

  const handleSave = useCallback(async () => {
    if (!name.trim()) return;
    await onUpdate(rt.id, { name: name.trim(), color });
    setEditing(false);
  }, [rt.id, name, color, onUpdate]);

  const handleCancel = () => {
    setName(rt.name);
    setColor(rt.color);
    setEditing(false);
    setShowColors(false);
  };

  if (editing) {
    return (
      <div className="flex flex-col gap-2 rounded-lg border border-violet-200 bg-violet-50/30 p-3">
        <div className="flex items-center gap-2">
          <div
            className="size-6 rounded-md border border-slate-200 cursor-pointer shrink-0"
            style={{ backgroundColor: color }}
            onClick={() => setShowColors(!showColors)}
          />
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="h-8 text-sm flex-1"
            placeholder="Название типа..."
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSave();
              if (e.key === "Escape") handleCancel();
            }}
          />
          <Button variant="ghost" size="icon-xs" onClick={handleSave} className="text-emerald-600 hover:text-emerald-700">
            <Check className="size-3.5" />
          </Button>
          <Button variant="ghost" size="icon-xs" onClick={handleCancel} className="text-slate-400 hover:text-slate-600">
            <X className="size-3.5" />
          </Button>
        </div>
        {showColors && (
          <div className="flex flex-wrap gap-1.5 pl-8">
            {PRESET_COLORS.map((c) => (
              <button
                key={c}
                onClick={() => { setColor(c); setShowColors(false); }}
                className={cn(
                  "size-6 rounded-md border-2 transition-all hover:scale-110",
                  color === c ? "border-slate-700 ring-1 ring-slate-400" : "border-transparent"
                )}
                style={{ backgroundColor: c }}
              />
            ))}
            <div className="flex items-center gap-1 ml-1">
              <Palette className="size-3 text-slate-400" />
              <input
                type="color"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                className="size-6 rounded border-0 p-0 cursor-pointer"
              />
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="group flex items-center gap-3 rounded-lg border border-slate-100 bg-white px-3 py-2.5 hover:border-slate-200 transition-colors">
      <div
        className="size-4 rounded-md shrink-0"
        style={{ backgroundColor: rt.color }}
      />
      <span className="flex-1 text-sm font-medium text-slate-700">{rt.name}</span>
      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          onClick={() => setEditing(true)}
          className="rounded p-1 text-slate-400 hover:text-slate-600 hover:bg-slate-100"
        >
          <Pencil className="size-3.5" />
        </button>
        <button
          onClick={() => onDelete(rt.id)}
          className="rounded p-1 text-slate-400 hover:text-red-500 hover:bg-red-50"
        >
          <Trash2 className="size-3.5" />
        </button>
      </div>
    </div>
  );
}

export function SettingsView() {
  const relationTypes = useBrainStore((s) => s.relationTypes);
  const fetchRelationTypes = useBrainStore((s) => s.fetchRelationTypes);
  const createRelationType = useBrainStore((s) => s.createRelationType);
  const updateRelationType = useBrainStore((s) => s.updateRelationType);
  const deleteRelationType = useBrainStore((s) => s.deleteRelationType);

  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState("#6b7280");
  const [showNewColors, setShowNewColors] = useState(false);

  useEffect(() => {
    fetchRelationTypes();
  }, [fetchRelationTypes]);

  const handleCreate = useCallback(async () => {
    if (!newName.trim()) return;
    await createRelationType(newName.trim(), newColor);
    setNewName("");
    setNewColor("#6b7280");
    setShowAdd(false);
    setShowNewColors(false);
  }, [newName, newColor, createRelationType]);

  return (
    <div className="flex-1 overflow-auto">
      <div className="mx-auto max-w-2xl px-6 py-8">
        <h1 className="text-xl font-bold text-slate-900 mb-1">Настройки</h1>
        <p className="text-sm text-slate-500 mb-6">Управление типами связей и другими параметрами</p>

        <Separator className="mb-6" />

        {/* Relation Types Section */}
        <div>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Link className="size-5 text-violet-500" />
              <h2 className="text-base font-semibold text-slate-800">Типы связей</h2>
              {relationTypes.length > 0 && (
                <span className="text-xs text-slate-400">({relationTypes.length})</span>
              )}
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowAdd(!showAdd)}
              className="gap-1.5 text-xs"
            >
              <Plus className="size-3.5" />
              Добавить тип
            </Button>
          </div>

          <p className="text-xs text-slate-400 mb-4">
            Типы связей позволяют классифицировать связи между задачами, заметками и клиентами. Например: &quot;Клиент&quot;, &quot;Блокирует&quot;, &quot;Связано с&quot;.
          </p>

          {showAdd && (
            <div className="mb-4 rounded-lg border border-violet-200 bg-violet-50/30 p-3 space-y-2">
              <div className="flex items-center gap-2">
                <div
                  className="size-6 rounded-md border border-slate-200 cursor-pointer shrink-0"
                  style={{ backgroundColor: newColor }}
                  onClick={() => setShowNewColors(!showNewColors)}
                />
                <Input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="Название нового типа..."
                  className="h-8 text-sm flex-1"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleCreate();
                    if (e.key === "Escape") { setShowAdd(false); setShowNewColors(false); }
                  }}
                />
                <Button size="sm" onClick={handleCreate} disabled={!newName.trim()} className="h-8 px-3 text-xs">
                  <Check className="size-3.5 mr-1" /> Создать
                </Button>
                <Button variant="ghost" size="icon-xs" onClick={() => { setShowAdd(false); setShowNewColors(false); }} className="text-slate-400">
                  <X className="size-3.5" />
                </Button>
              </div>
              {showNewColors && (
                <div className="flex flex-wrap gap-1.5 pl-8">
                  {PRESET_COLORS.map((c) => (
                    <button
                      key={c}
                      onClick={() => { setNewColor(c); setShowNewColors(false); }}
                      className={cn(
                        "size-6 rounded-md border-2 transition-all hover:scale-110",
                        newColor === c ? "border-slate-700 ring-1 ring-slate-400" : "border-transparent"
                      )}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                  <div className="flex items-center gap-1 ml-1">
                    <Palette className="size-3 text-slate-400" />
                    <input
                      type="color"
                      value={newColor}
                      onChange={(e) => setNewColor(e.target.value)}
                      className="size-6 rounded border-0 p-0 cursor-pointer"
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          {relationTypes.length === 0 && !showAdd && (
            <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50/50 px-6 py-8 text-center">
              <Link className="size-8 text-slate-300 mx-auto mb-2" />
              <p className="text-sm text-slate-500 mb-1">Типы связей пока не созданы</p>
              <p className="text-xs text-slate-400">Создайте типы, чтобы классифицировать связи между элементами</p>
            </div>
          )}

          <div className="space-y-1.5">
            {relationTypes.map((rt) => (
              <RelationTypeRow
                key={rt.id}
                rt={rt}
                onUpdate={updateRelationType}
                onDelete={deleteRelationType}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
