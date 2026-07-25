"use client";

// Управление представлением: группировка, набор и порядок колонок, именованные
// представления. Всё пишется в persist-стор — настройки переживают перезагрузку.

import { useState } from "react";
import { ArrowDown, ArrowUp, Bookmark, Check, Columns3, Group, ListTree, RotateCcw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { BASE_COLUMNS, useViewStore, type SavedView } from "@/lib/core/view-store";
import { GROUP_BY_LABELS, SUBTASK_MODE_LABELS, type GroupByField, type SubtaskMode } from "@/lib/core/views";
import { cn } from "@/lib/utils";

const GROUP_FIELDS: GroupByField[] = [
  "none",
  "status",
  "priority",
  "project",
  "assignee",
  "tag",
  "due",
  "estimate",
];

export function GroupByPopover() {
  const groupBy = useViewStore((s) => s.groupBy);
  const setGroupBy = useViewStore((s) => s.setGroupBy);
  const active = groupBy[0] !== "none";

  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button variant="ghost" size="sm" className={cn("gap-1.5 text-xs", active && "text-foreground")} />
        }
      >
        <Group className="size-3.5" />
        <span className="hidden sm:inline">
          {active ? GROUP_BY_LABELS[groupBy[0]] : "Группировка"}
          {groupBy[1] !== "none" && ` › ${GROUP_BY_LABELS[groupBy[1]]}`}
        </span>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-56 gap-3 p-2.5">
        <div className="flex flex-col gap-1">
          <span className="px-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Первый уровень
          </span>
          {GROUP_FIELDS.map((f) => (
            <button
              key={f}
              onClick={() => setGroupBy([f, f === "none" ? "none" : groupBy[1]])}
              className="flex items-center gap-2 rounded px-2 py-1 text-sm hover:bg-muted"
            >
              <span className="flex-1 text-left">{GROUP_BY_LABELS[f]}</span>
              {groupBy[0] === f && <Check className="size-3.5" />}
            </button>
          ))}
        </div>
        {groupBy[0] !== "none" && (
          <div className="flex flex-col gap-1 border-t border-border pt-2">
            <span className="px-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Второй уровень
            </span>
            {GROUP_FIELDS.filter((f) => f === "none" || f !== groupBy[0]).map((f) => (
              <button
                key={f}
                onClick={() => setGroupBy([groupBy[0], f])}
                className="flex items-center gap-2 rounded px-2 py-1 text-sm hover:bg-muted"
              >
                <span className="flex-1 text-left">{GROUP_BY_LABELS[f]}</span>
                {groupBy[1] === f && <Check className="size-3.5" />}
              </button>
            ))}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

const SUBTASK_MODES: SubtaskMode[] = ["nested", "flat", "hidden"];

export function SubtaskModePopover() {
  const subtaskMode = useViewStore((s) => s.subtaskMode);
  const setSubtaskMode = useViewStore((s) => s.setSubtaskMode);

  return (
    <Popover>
      <PopoverTrigger render={<Button variant="ghost" size="sm" className="gap-1.5 text-xs" />}>
        <ListTree className="size-3.5" />
        <span className="hidden lg:inline">Подзадачи</span>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-56 p-1">
        {SUBTASK_MODES.map((mode) => (
          <button
            key={mode}
            onClick={() => setSubtaskMode(mode)}
            className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted"
          >
            <span className="flex-1 text-left">{SUBTASK_MODE_LABELS[mode]}</span>
            {subtaskMode === mode && <Check className="size-3.5" />}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}

export function ColumnsPopover({ customFields }: { customFields: { id: string; name: string }[] }) {
  const columns = useViewStore((s) => s.columns);
  const setColumns = useViewStore((s) => s.setColumns);

  const available = [
    ...BASE_COLUMNS.map((c) => ({ id: c.id, label: c.label })),
    ...customFields.map((f) => ({ id: `field:${f.id}`, label: f.name })),
  ];
  // Скрытые — те, что есть в справочнике, но не выбраны; порядок среди видимых
  // задаёт пользователь, поэтому показываем сначала выбранные в их порядке.
  const visible = columns
    .map((id) => available.find((c) => c.id === id))
    .filter((c): c is { id: string; label: string } => Boolean(c));
  const hidden = available.filter((c) => !columns.includes(c.id));

  function toggle(id: string) {
    // Название — единственная колонка, без которой строка нечитаема.
    if (id === "title" && columns.includes(id)) return;
    setColumns(columns.includes(id) ? columns.filter((c) => c !== id) : [...columns, id]);
  }

  function move(id: string, delta: number) {
    const idx = columns.indexOf(id);
    const next = idx + delta;
    if (idx < 0 || next < 0 || next >= columns.length) return;
    const copy = [...columns];
    [copy[idx], copy[next]] = [copy[next], copy[idx]];
    setColumns(copy);
  }

  return (
    <Popover>
      <PopoverTrigger render={<Button variant="ghost" size="sm" className="gap-1.5 text-xs" />}>
        <Columns3 className="size-3.5" />
        <span className="hidden sm:inline">Колонки</span>
      </PopoverTrigger>
      <PopoverContent align="start" className="max-h-[70vh] w-64 gap-2 overflow-y-auto p-2.5">
        <span className="px-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Показаны
        </span>
        <div className="flex flex-col">
          {visible.map((c, i) => (
            <div key={c.id} className="flex items-center gap-1 rounded px-1 py-0.5 hover:bg-muted">
              <button
                onClick={() => toggle(c.id)}
                disabled={c.id === "title"}
                className="flex min-w-0 flex-1 items-center gap-2 text-left text-sm disabled:opacity-60"
              >
                <Check className="size-3.5 shrink-0 text-primary" />
                <span className="truncate">{c.label}</span>
              </button>
              <button
                onClick={() => move(c.id, -1)}
                disabled={i === 0}
                className="rounded p-0.5 text-muted-foreground hover:bg-background disabled:opacity-30"
                title="Выше"
              >
                <ArrowUp className="size-3" />
              </button>
              <button
                onClick={() => move(c.id, 1)}
                disabled={i === visible.length - 1}
                className="rounded p-0.5 text-muted-foreground hover:bg-background disabled:opacity-30"
                title="Ниже"
              >
                <ArrowDown className="size-3" />
              </button>
            </div>
          ))}
        </div>

        {hidden.length > 0 && (
          <>
            <span className="px-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Скрыты
            </span>
            <div className="flex flex-col">
              {hidden.map((c) => (
                <button
                  key={c.id}
                  onClick={() => toggle(c.id)}
                  className="flex items-center gap-2 rounded px-1 py-1 text-left text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  <span className="size-3.5 shrink-0" />
                  <span className="truncate">{c.label}</span>
                </button>
              ))}
            </div>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}

export function SavedViewsMenu() {
  const savedViews = useViewStore((s) => s.savedViews);
  const activeViewId = useViewStore((s) => s.activeViewId);
  const saveView = useViewStore((s) => s.saveView);
  const applyView = useViewStore((s) => s.applyView);
  const updateActiveView = useViewStore((s) => s.updateActiveView);
  const deleteView = useViewStore((s) => s.deleteView);
  const resetView = useViewStore((s) => s.resetView);
  const [name, setName] = useState("");

  const active: SavedView | undefined = savedViews.find((v) => v.id === activeViewId);

  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button variant="ghost" size="sm" className={cn("gap-1.5 text-xs", active && "text-foreground")} />
        }
      >
        <Bookmark className={cn("size-3.5", active && "fill-current")} />
        <span className="hidden sm:inline">{active ? active.name : "Представления"}</span>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 gap-2 p-2.5">
        {savedViews.length > 0 && (
          <div className="flex flex-col">
            {savedViews.map((v) => (
              <div key={v.id} className="flex items-center gap-1 rounded px-1 hover:bg-muted">
                <button
                  onClick={() => applyView(v.id)}
                  className="flex min-w-0 flex-1 items-center gap-2 py-1 text-left text-sm"
                >
                  <span className="truncate">{v.name}</span>
                  {v.id === activeViewId && <Check className="size-3.5 shrink-0 text-primary" />}
                </button>
                <button
                  onClick={() => deleteView(v.id)}
                  className="rounded p-1 text-muted-foreground hover:bg-background hover:text-destructive"
                  title="Удалить представление"
                >
                  <Trash2 className="size-3" />
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="flex gap-1.5 border-t border-border pt-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && name.trim()) {
                saveView(name.trim());
                setName("");
              }
            }}
            placeholder="Название представления"
            className="h-7 min-w-0 flex-1 rounded-lg border border-input bg-transparent px-2 text-sm outline-none focus-visible:border-ring"
          />
          <Button
            size="xs"
            disabled={!name.trim()}
            onClick={() => {
              saveView(name.trim());
              setName("");
            }}
          >
            Сохранить
          </Button>
        </div>

        <div className="flex items-center gap-1.5">
          {active && (
            <Button variant="outline" size="xs" onClick={updateActiveView} className="flex-1">
              Обновить «{active.name}»
            </Button>
          )}
          <Button variant="ghost" size="xs" onClick={resetView} className="gap-1">
            <RotateCcw className="size-3" /> Сбросить
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
