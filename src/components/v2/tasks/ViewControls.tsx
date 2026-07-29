"use client";

// Настройки таблицы задач: группировка, подзадачи, набор и порядок колонок,
// именованные представления и способ открытия карточки. Всё собрано в одну
// кнопку-шестерёнку: четыре отдельных поповера занимали половину шапки, хотя
// открывают их редко, а место нужно списку.
//
// Значения пишутся в persist-стор — настройки переживают перезагрузку.

import { useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Bookmark,
  Check,
  Columns3,
  Group,
  ListTree,
  PanelRight,
  RotateCcw,
  Settings2,
  Square,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  BASE_COLUMNS,
  TASK_OPEN_MODE_LABELS,
  useTaskOpenStore,
  useViewStore,
  type SavedView,
  type TaskOpenMode,
} from "@/lib/core/view-store";
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

const SUBTASK_MODES: SubtaskMode[] = ["nested", "flat", "hidden"];

type SectionId = "group" | "subtasks" | "columns" | "views" | "open";

const SECTIONS: { id: SectionId; label: string; icon: typeof Group }[] = [
  { id: "group", label: "Группировка", icon: Group },
  { id: "subtasks", label: "Подзадачи", icon: ListTree },
  { id: "columns", label: "Колонки", icon: Columns3 },
  { id: "views", label: "Представления", icon: Bookmark },
  { id: "open", label: "Открытие задачи", icon: PanelRight },
];

const SUBHEAD = "px-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground";

/** Единственная кнопка настроек таблицы. */
export function ViewSettingsPopover({ customFields }: { customFields: { id: string; name: string }[] }) {
  const [section, setSection] = useState<SectionId>("group");
  const activeViewId = useViewStore((s) => s.activeViewId);
  const savedViews = useViewStore((s) => s.savedViews);
  const activeView = savedViews.find((v) => v.id === activeViewId);

  return (
    <Popover>
      <PopoverTrigger render={<Button variant="ghost" size="sm" className="gap-1.5 text-xs" />}>
        <Settings2 className="size-3.5" />
        {/* Имя активного представления важнее слова «Настройки»: по нему видно,
            в каком срезе сейчас смотрят список. */}
        <span className="hidden max-w-32 truncate sm:inline">
          {activeView ? activeView.name : "Настройки"}
        </span>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(92vw,460px)] gap-0 p-0">
        <div className="flex max-h-[70vh] min-h-0">
          <nav className="flex w-40 shrink-0 flex-col gap-0.5 border-r border-border p-1.5">
            {SECTIONS.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                onClick={() => setSection(id)}
                className={cn(
                  "flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs",
                  section === id
                    ? "bg-muted font-medium text-foreground"
                    : "text-muted-foreground hover:bg-muted/60",
                )}
              >
                <Icon className="size-3.5 shrink-0" />
                <span className="truncate">{label}</span>
              </button>
            ))}
          </nav>
          <div className="flex min-w-0 flex-1 flex-col gap-2 overflow-y-auto p-2.5">
            {section === "group" && <GroupBySection />}
            {section === "subtasks" && <SubtaskModeSection />}
            {section === "columns" && <ColumnsSection customFields={customFields} />}
            {section === "views" && <SavedViewsSection />}
            {section === "open" && <TaskOpenModeSection />}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

// --- Группировка -------------------------------------------------------------------

function GroupBySection() {
  const groupBy = useViewStore((s) => s.groupBy);
  const setGroupBy = useViewStore((s) => s.setGroupBy);

  return (
    <>
      <span className={SUBHEAD}>Первый уровень</span>
      <div className="flex flex-col gap-0.5">
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
        <div className="flex flex-col gap-0.5 border-t border-border pt-2">
          <span className={SUBHEAD}>Второй уровень</span>
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
    </>
  );
}

// --- Подзадачи ----------------------------------------------------------------------

function SubtaskModeSection() {
  const subtaskMode = useViewStore((s) => s.subtaskMode);
  const setSubtaskMode = useViewStore((s) => s.setSubtaskMode);

  return (
    <>
      <span className={SUBHEAD}>Как показывать подзадачи</span>
      <div className="flex flex-col gap-0.5">
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
      </div>
    </>
  );
}

// --- Колонки -------------------------------------------------------------------------

function ColumnsSection({ customFields }: { customFields: { id: string; name: string }[] }) {
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
    <>
      <span className={SUBHEAD}>Показаны</span>
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
          <span className={SUBHEAD}>Скрыты</span>
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
    </>
  );
}

// --- Представления ---------------------------------------------------------------------

function SavedViewsSection() {
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
    <>
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
          <Button variant="outline" size="xs" onClick={updateActiveView} className="min-w-0 flex-1">
            <span className="truncate">Обновить «{active.name}»</span>
          </Button>
        )}
        <Button variant="ghost" size="xs" onClick={resetView} className="gap-1">
          <RotateCcw className="size-3" /> Сбросить
        </Button>
      </div>
    </>
  );
}

// --- Как открывается карточка ------------------------------------------------------------

const OPEN_MODES: { mode: TaskOpenMode; icon: typeof PanelRight }[] = [
  { mode: "sheet", icon: PanelRight },
  { mode: "modal", icon: Square },
];

function TaskOpenModeSection() {
  const mode = useTaskOpenStore((s) => s.mode);
  const setMode = useTaskOpenStore((s) => s.setMode);

  return (
    <>
      <span className={SUBHEAD}>Где открывать задачу</span>
      <div className="flex gap-2">
        {OPEN_MODES.map(({ mode: value, icon: Icon }) => (
          <button
            key={value}
            onClick={() => setMode(value)}
            title={TASK_OPEN_MODE_LABELS[value]}
            aria-pressed={mode === value}
            className={cn(
              "flex flex-1 flex-col items-center gap-1.5 rounded-lg border px-2 py-3 text-[11px] leading-tight",
              mode === value
                ? "border-primary bg-primary/10 text-primary"
                : "border-border text-muted-foreground hover:bg-muted",
            )}
          >
            <Icon className="size-5" />
            <span className="text-center">{TASK_OPEN_MODE_LABELS[value]}</span>
          </button>
        ))}
      </div>
      <p className="px-1 text-[11px] text-muted-foreground">
        На узком экране карточка всегда открывается во весь экран.
      </p>
    </>
  );
}
