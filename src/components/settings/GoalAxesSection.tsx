"use client";

import { useEffect, useState } from "react";
import { useBrainStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Pencil, Trash2, Check, X, Plus, Target, Palette } from "lucide-react";

const PRESET_COLORS = [
  { color: "#22c55e", bg: "#dcfce7" },
  { color: "#ef4444", bg: "#fee2e2" },
  { color: "#3b82f6", bg: "#dbeafe" },
  { color: "#f97316", bg: "#ffedd5" },
  { color: "#8b5cf6", bg: "#ede9fe" },
  { color: "#ec4899", bg: "#fce7f3" },
  { color: "#14b8a6", bg: "#ccfbf1" },
  { color: "#eab308", bg: "#fef9c3" },
  { color: "#06b6d4", bg: "#cffafe" },
  { color: "#64748b", bg: "#f1f5f9" },
];

export function GoalAxesSection() {
  const axes = useBrainStore((s) => s.goalAxes);
  const axesLoaded = useBrainStore((s) => s.goalAxesLoaded);
  const fetchAxes = useBrainStore((s) => s.fetchGoalAxes);
  const createAxis = useBrainStore((s) => s.createGoalAxis);
  const updateAxis = useBrainStore((s) => s.updateGoalAxis);
  const deleteAxis = useBrainStore((s) => s.deleteGoalAxis);

  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [newIcon, setNewIcon] = useState("◆");
  const [newColor, setNewColor] = useState(PRESET_COLORS[0].color);
  const [newBg, setNewBg] = useState(PRESET_COLORS[0].bg);

  useEffect(() => {
    if (!axesLoaded) void fetchAxes();
  }, [axesLoaded, fetchAxes]);

  async function handleCreate() {
    if (!newName.trim()) return;
    await createAxis({ name: newName.trim(), icon: newIcon || "◆", color: newColor, bg: newBg });
    setNewName("");
    setNewIcon("◆");
    setNewColor(PRESET_COLORS[0].color);
    setNewBg(PRESET_COLORS[0].bg);
    setAdding(false);
  }

  return (
    <section className="rounded-xl border border-slate-200/80 bg-white p-3.5 shadow-sm">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Target className="size-4 text-violet-500" />
          <span className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-500">Оси целей</span>
          {axes.length > 0 && <span className="text-xs text-slate-400">({axes.length})</span>}
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setAdding((v) => !v)}
          className="h-7 gap-1 rounded-lg border-slate-200 px-2.5 text-xs"
        >
          <Plus className="size-3.5" />
          Добавить
        </Button>
      </div>

      <p className="mb-2 text-[11px] leading-snug text-slate-400">
        Оси — это тематические ярлыки целей (Доход, Здоровье и т.д.). Системные оси
        нельзя удалить, но можно переименовать и перекрасить.
      </p>

      {adding && (
        <div className="mb-3 space-y-2 rounded-lg border border-violet-200 bg-violet-50/30 p-2.5">
          <div className="flex items-center gap-2">
            <span
              className="flex size-7 shrink-0 items-center justify-center rounded-md text-sm font-semibold"
              style={{ backgroundColor: newBg, color: newColor }}
            >
              {newIcon}
            </span>
            <Input
              value={newIcon}
              onChange={(e) => setNewIcon(e.target.value.slice(0, 2))}
              placeholder="◆"
              className="h-8 w-12 rounded-lg bg-white text-center text-sm"
              maxLength={2}
            />
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Название оси..."
              className="h-8 flex-1 rounded-lg bg-white text-sm"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCreate();
                if (e.key === "Escape") setAdding(false);
              }}
            />
            <Button size="sm" onClick={handleCreate} disabled={!newName.trim()} className="h-8 px-2.5 text-xs">
              <Check className="mr-1 size-3.5" /> Создать
            </Button>
            <Button variant="ghost" size="icon-xs" onClick={() => setAdding(false)} className="text-slate-400">
              <X className="size-3.5" />
            </Button>
          </div>
          <ColorPalette
            color={newColor}
            onPick={(c, b) => {
              setNewColor(c);
              setNewBg(b);
            }}
          />
        </div>
      )}

      <div className="space-y-1">
        {axes.length === 0 && !adding && (
          <p className="rounded-lg border border-dashed border-slate-200 px-3 py-3 text-center text-xs text-slate-400">
            Нет осей
          </p>
        )}
        {axes.map((ax) => (
          <AxisRow
            key={ax.id}
            axis={ax}
            onUpdate={(updates) => updateAxis(ax.id, updates)}
            onDelete={async () => {
              if (ax.is_system) {
                alert("Системную ось нельзя удалить, но можно переименовать или скрыть.");
                return;
              }
              if (!confirm(`Удалить ось «${ax.name}»? Цели потеряют привязку к ней.`)) return;
              const r = await deleteAxis(ax.id);
              if (!r.ok && r.error) alert(r.error);
            }}
          />
        ))}
      </div>
    </section>
  );
}

function ColorPalette({
  color,
  onPick,
}: {
  color: string;
  onPick: (color: string, bg: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 pl-9">
      {PRESET_COLORS.map((c) => (
        <button
          type="button"
          key={c.color}
          onClick={() => onPick(c.color, c.bg)}
          className={cn(
            "size-5 rounded-md border-2 transition-all hover:scale-110",
            color === c.color ? "border-slate-700 ring-1 ring-slate-400" : "border-transparent",
          )}
          style={{ backgroundColor: c.color }}
        />
      ))}
      <Palette className="ml-1 size-3 text-slate-400" />
    </div>
  );
}

function AxisRow({
  axis,
  onUpdate,
  onDelete,
}: {
  axis: { id: string; name: string; color: string; bg: string; icon: string; is_system: number };
  onUpdate: (updates: { name?: string; icon?: string; color?: string; bg?: string }) => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(axis.name);
  const [icon, setIcon] = useState(axis.icon);
  const [color, setColor] = useState(axis.color);
  const [bg, setBg] = useState(axis.bg);

  async function save() {
    if (!name.trim()) return;
    await onUpdate({ name: name.trim(), icon: icon || "◆", color, bg });
    setEditing(false);
  }

  function cancel() {
    setName(axis.name);
    setIcon(axis.icon);
    setColor(axis.color);
    setBg(axis.bg);
    setEditing(false);
  }

  if (editing) {
    return (
      <div className="space-y-2 rounded-lg border border-violet-200 bg-violet-50/30 p-2.5">
        <div className="flex items-center gap-2">
          <span
            className="flex size-7 shrink-0 items-center justify-center rounded-md text-sm font-semibold"
            style={{ backgroundColor: bg, color }}
          >
            {icon}
          </span>
          <Input value={icon} onChange={(e) => setIcon(e.target.value.slice(0, 2))} className="h-8 w-12 text-center text-sm" maxLength={2} />
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="h-8 flex-1 text-sm"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter") save();
              if (e.key === "Escape") cancel();
            }}
          />
          <Button variant="ghost" size="icon-xs" onClick={save} className="text-emerald-600">
            <Check className="size-3.5" />
          </Button>
          <Button variant="ghost" size="icon-xs" onClick={cancel} className="text-slate-400">
            <X className="size-3.5" />
          </Button>
        </div>
        <ColorPalette
          color={color}
          onPick={(c, b) => {
            setColor(c);
            setBg(b);
          }}
        />
      </div>
    );
  }

  return (
    <div className="group flex items-center gap-2 rounded-lg border border-slate-100 bg-white px-2.5 py-2">
      <span
        className="flex size-7 shrink-0 items-center justify-center rounded-md text-sm font-semibold"
        style={{ backgroundColor: axis.bg, color: axis.color }}
      >
        {axis.icon}
      </span>
      <span className="flex-1 truncate text-sm font-medium text-slate-700">{axis.name}</span>
      <span className="font-mono text-[10px] text-slate-300">{axis.id}</span>
      <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
        <button onClick={() => setEditing(true)} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600">
          <Pencil className="size-3.5" />
        </button>
        {!axis.is_system && (
          <button onClick={onDelete} className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-500">
            <Trash2 className="size-3.5" />
          </button>
        )}
      </div>
      {!!axis.is_system && <span className="shrink-0 text-[10px] text-slate-400">системная</span>}
    </div>
  );
}
