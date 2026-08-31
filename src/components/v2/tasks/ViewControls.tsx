"use client";

// Настройки таблицы задач: группировка, подзадачи, набор и порядок колонок,
// именованные представления и способ открытия карточки. Всё собрано в одну
// кнопку-шестерёнку: четыре отдельных поповера занимали половину шапки, хотя
// открывают их редко, а место нужно списку.
//
// Значения пишутся в persist-стор — настройки переживают перезагрузку.

import { useState } from "react";
import {
  Bookmark,
  Check,
  Columns3,
  Copy,
  GripVertical,
  Group,
  ListTree,
  PanelRight,
  Plus,
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
import { useGroupValues } from "./group-naming";
import { useRowDrag } from "./use-row-drag";

const GROUP_FIELDS: GroupByField[] = [
  "none",
  "status",
  "priority",
  "project",
  "assignee",
  "tag",
  "due",
  "planned",
  "estimate",
];

const SUBTASK_MODES: SubtaskMode[] = ["nested", "flat", "hidden"];

export type SectionId = "group" | "subtasks" | "columns" | "views" | "open";

const SECTIONS: { id: SectionId; label: string; icon: typeof Group }[] = [
  { id: "group", label: "Группировка", icon: Group },
  { id: "subtasks", label: "Подзадачи", icon: ListTree },
  { id: "columns", label: "Колонки", icon: Columns3 },
  { id: "views", label: "Представления", icon: Bookmark },
  { id: "open", label: "Открытие задачи", icon: PanelRight },
];

/** Что из настроек умеет доска: колонок, группировки и подзадач у неё нет. */
export const BOARD_SECTIONS: SectionId[] = ["views", "open"];

/**
 * Гант раскладывает строки той же группировкой и тем же режимом подзадач, что и
 * таблица, — им он управляется. Колонок у него нет: слева одна колонка с
 * названием, а всё остальное место занимает полотно.
 */
export const GANTT_SECTIONS: SectionId[] = ["group", "subtasks", "views", "open"];

/**
 * Календарю группировка не нужна вовсе: задачу кладёт на место её дата, а не
 * корзина. Раздел, который ничего не меняет, читается как сломанный — поэтому
 * здесь остались представления и способ открытия карточки.
 */
export const CALENDAR_SECTIONS: SectionId[] = ["views", "open"];

const SUBHEAD = "px-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground";

/**
 * Единственная кнопка настроек списка. `sections` сужает состав: доска
 * показывает только то, на что она реагирует — раздел, не влияющий на экран,
 * хуже отсутствующего, потому что выглядит сломанным.
 */
export function ViewSettingsPopover({
  customFields,
  sections = SECTIONS.map((s) => s.id),
}: {
  customFields: { id: string; name: string }[];
  sections?: SectionId[];
}) {
  const shown = SECTIONS.filter((s) => sections.includes(s.id));
  const [section, setSection] = useState<SectionId>(shown[0]?.id ?? "group");
  const activeViewId = useViewStore((s) => s.activeViewId);
  const savedViews = useViewStore((s) => s.savedViews);
  const activeView = savedViews.find((v) => v.id === activeViewId);
  // Список разделов задаёт экран и не меняет по ходу жизни — но если выбранный
  // всё же выпал, показываем первый доступный вместо пустой правой половины.
  const current = shown.some((s) => s.id === section) ? section : (shown[0]?.id ?? "group");

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
            {shown.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                onClick={() => setSection(id)}
                className={cn(
                  "flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs",
                  current === id
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
            {current === "group" && <GroupBySection />}
            {current === "subtasks" && <SubtaskModeSection />}
            {current === "columns" && <ColumnsSection customFields={customFields} />}
            {current === "views" && <SavedViewsSection />}
            {current === "open" && <TaskOpenModeSection />}
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

      {/* Порядок — на каждый выбранный тип свой блок: настройка привязана к
          полю, а не к уровню, и «Статус» вторым уровнем должен идти так же, как
          первым. */}
      {groupBy[0] !== "none" && <GroupOrderBlock field={groupBy[0]} />}
      {groupBy[1] !== "none" && <GroupOrderBlock field={groupBy[1]} />}
    </>
  );
}

/**
 * Порядок групп внутри одного типа группировки: перетаскивание за ручку, как у
 * колонок. Список — весь справочник поля, а не встретившиеся в данных ключи:
 * порядок должен переживать пустую группу.
 *
 * Наверх уходит порядок целиком (все значения поля), а не сдвиг одного: иначе
 * «расставленные» и «остальные» перемешивались бы после каждой перестановки.
 * Значения, которых уже нет в справочнике (удалённый статус), остаются в
 * сохранённой записи безвредно — их просто некому сопоставить.
 */
function GroupOrderBlock({ field }: { field: GroupByField }) {
  const custom = useViewStore((s) => s.groupOrder[field] != null);
  const setOrder = useViewStore((s) => s.setGroupFieldOrder);
  const resetOrder = useViewStore((s) => s.resetGroupFieldOrder);
  const values = useGroupValues(field);

  const drag = useRowDrag(values.length, (from, to) => {
    const ids = values.map((v) => v.id);
    const [moved] = ids.splice(from, 1);
    ids.splice(to, 0, moved);
    setOrder(field, ids);
  });

  if (values.length < 2) return null;

  return (
    <div className="flex flex-col gap-1 border-t border-border pt-2">
      <div className="flex items-center gap-2">
        <span className={cn(SUBHEAD, "flex-1")}>Порядок групп: {GROUP_BY_LABELS[field]}</span>
        {custom && (
          <Button
            variant="ghost"
            size="xs"
            className="shrink-0 gap-1 text-[11px] text-muted-foreground"
            onClick={() => resetOrder(field)}
            title="Вернуть порядок по умолчанию"
          >
            <RotateCcw className="size-3" />
            Сбросить
          </Button>
        )}
      </div>
      <div className="flex select-none flex-col">
        {values.map((v, i) => {
          const dragging = drag.draggingId === v.id;
          return (
            <div
              key={v.id}
              style={{ transform: `translate3d(0, ${drag.shiftOf(i)}px, 0)`, zIndex: dragging ? 10 : undefined }}
              className={cn(
                "relative flex h-8 items-center gap-1 rounded px-1",
                drag.idle && "hover:bg-muted",
                dragging && "bg-background shadow-md ring-1 ring-ring",
                // Переход только на время жеста — иначе к моменту отпускания
                // проигрывается возврат из уже применённого сдвига, то есть
                // рывок. Наведение соседям тоже незачем: подсветка бежала бы
                // за курсором.
                !drag.idle && !dragging && "pointer-events-none transition-transform duration-150 ease-out",
              )}
            >
              <button
                {...drag.handlers(i, v.id)}
                // touch-none обязателен: без него палец прокручивает поповер.
                className={cn(
                  "shrink-0 touch-none rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground",
                  dragging ? "cursor-grabbing" : "cursor-grab",
                )}
                title="Перетащите, чтобы изменить порядок (или ↑/↓)"
                aria-label={`Переместить группу «${v.label}»`}
              >
                <GripVertical className="size-3.5" />
              </button>
              {v.color ? (
                <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: v.color }} />
              ) : (
                <span className="w-1 shrink-0" />
              )}
              <span className="min-w-0 flex-1 truncate text-sm">{v.label}</span>
              <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground/70">{i + 1}</span>
            </div>
          );
        })}
      </div>
      <p className="px-1 text-[11px] text-muted-foreground">
        Порядок — перетаскиванием за ручку слева. Группы, которых здесь нет (новый статус, новый
        проект), идут после расставленных; «без значения» — всегда последней.
      </p>
    </div>
  );
}

// --- Подзадачи ----------------------------------------------------------------------

function SubtaskModeSection() {
  const subtaskMode = useViewStore((s) => s.subtaskMode);
  const setSubtaskMode = useViewStore((s) => s.setSubtaskMode);
  const manualOrder = useViewStore((s) => s.subtaskManualOrder);
  const setManualOrder = useViewStore((s) => s.setSubtaskManualOrder);

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

      {/* Только для вложенного режима: в двух других веток нет вовсе, и
          переключатель, который ничего не меняет, читается как сломанный. */}
      {subtaskMode === "nested" && (
        <>
          <span className={SUBHEAD}>Порядок внутри ветки</span>
          <button
            onClick={() => setManualOrder(!manualOrder)}
            className="flex w-full items-start gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-muted"
          >
            <span className="flex-1">
              Ручной порядок
              <span className="block text-[11px] text-muted-foreground">
                Как расставили в карточке, а не текущей сортировкой списка
              </span>
            </span>
            {manualOrder ? (
              <Check className="mt-0.5 size-3.5 shrink-0" />
            ) : (
              <Square className="mt-0.5 size-3.5 shrink-0 opacity-40" />
            )}
          </button>
        </>
      )}
    </>
  );
}

// --- Колонки -------------------------------------------------------------------------

/** Высота строки списка колонок. Держать синхронно с классом `h-8` ниже. */
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

  /**
   * Новый порядок по перестановке среди видимых. В `columns` могут лежать id
   * полей, которых уже нет в справочнике: их позиции не трогаем — иначе правка
   * порядка молча выкидывала бы колонку, которая вернётся вместе с полем.
   */
  function reorder(from: number, to: number) {
    if (from === to) return;
    const ids = visible.map((c) => c.id);
    const [moved] = ids.splice(from, 1);
    ids.splice(to, 0, moved);
    const slots = visible.map((c) => columns.indexOf(c.id));
    const next = [...columns];
    slots.forEach((slot, i) => {
      next[slot] = ids[i];
    });
    setColumns(next);
  }

  const drag = useRowDrag(visible.length, reorder);

  return (
    <>
      <span className={SUBHEAD}>Текст в строке</span>
      <WrapTitleToggle />

      <span className={SUBHEAD}>Показаны</span>
      <div className="flex select-none flex-col">
        {visible.map((c, i) => {
          const dragging = drag.draggingId === c.id;
          return (
            <div
              key={c.id}
              style={{ transform: `translate3d(0, ${drag.shiftOf(i)}px, 0)`, zIndex: dragging ? 10 : undefined }}
              className={cn(
                "relative flex h-8 items-center gap-1 rounded px-1",
                drag.idle && "hover:bg-muted",
                dragging && "bg-background shadow-md ring-1 ring-ring",
                // Соседи расступаются плавно — но переход живёт только на время
                // перетаскивания. Оставить его включённым к моменту отпускания
                // значит проиграть возврат из уже применённого сдвига: это и
                // есть тот рывок, ради которого всё затевалось. Заодно соседи не
                // ловят наведение, чтобы подсветка не бежала за курсором.
                !drag.idle && !dragging && "pointer-events-none transition-transform duration-150 ease-out",
              )}
            >
              <button
                {...drag.handlers(i, c.id)}
                // touch-none обязателен: без него палец на телефоне прокручивает
                // поповер вместо перетаскивания.
                className={cn(
                  "shrink-0 touch-none rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground",
                  dragging ? "cursor-grabbing" : "cursor-grab",
                )}
                title="Перетащите, чтобы изменить порядок (или ↑/↓)"
                aria-label={`Переместить колонку «${c.label}»`}
              >
                <GripVertical className="size-3.5" />
              </button>
              <button
                onClick={() => toggle(c.id)}
                disabled={c.id === "title"}
                className="flex min-w-0 flex-1 items-center gap-2 text-left text-sm disabled:opacity-60"
                title={c.id === "title" ? "Без названия строка нечитаема" : "Скрыть колонку"}
              >
                <Check className="size-3.5 shrink-0 text-primary" />
                <span className="truncate">{c.label}</span>
              </button>
            </div>
          );
        })}
      </div>
      <p className="px-1 text-[11px] text-muted-foreground">
        Порядок — перетаскиванием за ручку слева. Клик по названию убирает колонку.
      </p>

      {hidden.length > 0 && (
        <>
          <span className={SUBHEAD}>Скрыты</span>
          <div className="flex flex-col">
            {hidden.map((c) => (
              <button
                key={c.id}
                onClick={() => toggle(c.id)}
                className="flex h-8 items-center gap-2 rounded px-1 text-left text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <Plus className="size-3.5 shrink-0 opacity-60" />
                <span className="truncate">{c.label}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </>
  );
}

/**
 * Перенос названия. Живёт в разделе «Колонки», а не отдельным пунктом слева:
 * настройки представления — одна кнопка, и плодить разделы ради переключателя
 * значит вернуть россыпь поповеров в шапке.
 */
function WrapTitleToggle() {
  const wrapTitle = useViewStore((s) => s.wrapTitle);
  const setWrapTitle = useViewStore((s) => s.setWrapTitle);

  return (
    <button
      onClick={() => setWrapTitle(!wrapTitle)}
      role="switch"
      aria-checked={wrapTitle}
      className="flex h-8 items-center gap-2 rounded px-1 text-left text-sm hover:bg-muted"
    >
      <span
        className={cn(
          "flex size-3.5 shrink-0 items-center justify-center rounded-[4px] border",
          wrapTitle ? "border-primary bg-primary text-primary-foreground" : "border-input",
        )}
      >
        {wrapTitle && <Check className="size-2.5" />}
      </span>
      <span className="min-w-0 flex-1 truncate">Переносить название на следующую строку</span>
    </button>
  );
}

// --- Представления ---------------------------------------------------------------------

function SavedViewsSection() {
  const savedViews = useViewStore((s) => s.savedViews);
  const activeViewId = useViewStore((s) => s.activeViewId);
  const saveView = useViewStore((s) => s.saveView);
  const applyView = useViewStore((s) => s.applyView);
  const duplicateView = useViewStore((s) => s.duplicateView);
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
                onClick={() => duplicateView(v.id)}
                className="rounded p-1 text-muted-foreground hover:bg-background hover:text-foreground"
                title="Дублировать — править копию, не задев оригинал"
              >
                <Copy className="size-3" />
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

      {/* Автосохранение незаметно, а последствия у него заметные: без подписи
          человек правит настройки, не зная, что переписывает сохранённый срез. */}
      <p className="px-1 text-[11px] text-muted-foreground">
        {active
          ? `Настройки уходят в «${active.name}» сразу. Нужен вариант — дублируйте, оригинал останется прежним.`
          : "Выбранное представление дальше запоминает настройки само."}
      </p>

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
          placeholder="Новое из текущих настроек"
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

      <Button variant="ghost" size="xs" onClick={resetView} className="gap-1 self-start">
        <RotateCcw className="size-3" /> Сбросить
      </Button>
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
