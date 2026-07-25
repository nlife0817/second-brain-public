"use client";

// Таблица сводного списка: шапка с сортировкой и ресайзом, двухуровневые
// группы, выбор строк. Данные приходят уже отфильтрованными и отсортированными —
// таблица только раскладывает их по группам и рисует.

import { memo, useCallback, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight, ArrowDown, ArrowUp } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import {
  AssigneesCell,
  CommentsCell,
  CustomFieldCell,
  DueCell,
  EstimateCell,
  PlainDateCell,
  PriorityCell,
  ProjectCell,
  StatusCell,
  SubtasksCell,
  TagsCell,
  TitleCell,
  type CellContext,
} from "./cells";
import type { TaskRow } from "@/lib/core/types";
import { BASE_COLUMNS, COLUMN_MAX_WIDTH, COLUMN_MIN_WIDTH, type ColumnDef } from "@/lib/core/view-store";
import type { GroupByField, MatchContext, SortState } from "@/lib/core/views";
import { groupKeys } from "@/lib/core/views";
import { cn } from "@/lib/utils";

/**
 * Сколько строк группа рисует сразу. Экран собирает задачи всех проектов —
 * без предела это тысячи DOM-узлов, и первый рендер заметно проседает.
 */
const GROUP_PAGE = 100;

const SELECT_COLUMN_WIDTH = 34;

export interface GroupLabel {
  text: string;
  color?: string;
}

export interface TaskTableProps {
  tasks: TaskRow[];
  columns: ColumnDef[];
  ctx: CellContext;
  groupBy: [GroupByField, GroupByField];
  matchCtx: MatchContext;
  sort: SortState;
  onToggleSort: (column: string) => void;
  onResize: (columnId: string, width: number) => void;
  selected: ReadonlySet<string>;
  onToggleSelected: (taskId: string, checked: boolean) => void;
  onSelectMany: (taskIds: string[], checked: boolean) => void;
  collapsed: ReadonlySet<string>;
  onToggleCollapsed: (key: string) => void;
  onOpen: (taskId: string) => void;
  labelForGroup: (field: GroupByField, key: string) => GroupLabel;
  /** Порядок ключей группы: справочники имеют свой (позиция статуса и т.п.). */
  groupOrder: (field: GroupByField, keys: string[]) => string[];
}

interface GroupNode {
  key: string;
  path: string;
  label: GroupLabel;
  tasks: TaskRow[];
  children: GroupNode[];
}

function buildGroups(
  tasks: TaskRow[],
  fields: [GroupByField, GroupByField],
  matchCtx: MatchContext,
  labelForGroup: TaskTableProps["labelForGroup"],
  groupOrder: TaskTableProps["groupOrder"],
): GroupNode[] {
  const [first, second] = fields;
  if (first === "none") {
    return [{ key: "__all__", path: "__all__", label: { text: "" }, tasks, children: [] }];
  }

  const buckets = new Map<string, TaskRow[]>();
  for (const task of tasks) {
    // Задача с несколькими проектами/исполнителями/тегами попадает в каждую
    // группу — иначе список молча теряет часть её принадлежностей.
    for (const key of groupKeys(task, first, matchCtx)) {
      const arr = buckets.get(key);
      if (arr) arr.push(task);
      else buckets.set(key, [task]);
    }
  }

  return groupOrder(first, [...buckets.keys()]).map((key) => {
    const rows = buckets.get(key) ?? [];
    const path = `${first}:${key}`;
    if (second === "none") {
      return { key, path, label: labelForGroup(first, key), tasks: rows, children: [] };
    }
    const sub = new Map<string, TaskRow[]>();
    for (const task of rows) {
      for (const subKey of groupKeys(task, second, matchCtx)) {
        const arr = sub.get(subKey);
        if (arr) arr.push(task);
        else sub.set(subKey, [task]);
      }
    }
    return {
      key,
      path,
      label: labelForGroup(first, key),
      tasks: rows,
      children: groupOrder(second, [...sub.keys()]).map((subKey) => ({
        key: subKey,
        path: `${path}/${second}:${subKey}`,
        label: labelForGroup(second, subKey),
        tasks: sub.get(subKey) ?? [],
        children: [],
      })),
    };
  });
}

// --- Шапка ------------------------------------------------------------------------

function HeaderCell({
  column,
  width,
  sort,
  onToggleSort,
  onResize,
}: {
  column: ColumnDef;
  width: number;
  sort: SortState;
  onToggleSort: (column: string) => void;
  onResize: (columnId: string, width: number) => void;
}) {
  const startRef = useRef<{ x: number; width: number } | null>(null);
  const active = sort.column === column.id;

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      startRef.current = { x: e.clientX, width };
      const target = e.currentTarget as HTMLElement;
      target.setPointerCapture(e.pointerId);
    },
    [width],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const start = startRef.current;
      if (!start) return;
      const next = Math.min(COLUMN_MAX_WIDTH, Math.max(COLUMN_MIN_WIDTH, start.width + (e.clientX - start.x)));
      onResize(column.id, next);
    },
    [column.id, onResize],
  );

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    startRef.current = null;
    const target = e.currentTarget as HTMLElement;
    if (target.hasPointerCapture(e.pointerId)) target.releasePointerCapture(e.pointerId);
  }, []);

  return (
    <div
      className="group/head relative flex shrink-0 items-center border-r border-border/60 px-1.5 last:border-r-0"
      style={{ width }}
    >
      <button
        disabled={!column.sortable}
        onClick={() => column.sortable && onToggleSort(column.id)}
        className={cn(
          "flex min-w-0 flex-1 items-center gap-1 truncate text-left text-[11px] font-semibold uppercase tracking-wide",
          column.sortable ? "hover:text-foreground" : "cursor-default",
          active ? "text-foreground" : "text-muted-foreground",
        )}
        title={column.label}
      >
        <span className="truncate">{column.headerLabel ?? column.label}</span>
        {active &&
          (sort.direction === "asc" ? (
            <ArrowUp className="size-3 shrink-0" />
          ) : (
            <ArrowDown className="size-3 shrink-0" />
          ))}
      </button>
      <span
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        className="absolute -right-1 top-0 z-10 h-full w-2 cursor-col-resize touch-none opacity-0 transition-opacity after:absolute after:left-1/2 after:h-full after:w-px after:bg-primary group-hover/head:opacity-100"
        title="Потянуть, чтобы изменить ширину"
      />
    </div>
  );
}

// --- Строка -----------------------------------------------------------------------

const Row = memo(function Row({
  task,
  columns,
  widths,
  ctx,
  depth,
  selected,
  onToggleSelected,
  onOpen,
}: {
  task: TaskRow;
  columns: ColumnDef[];
  widths: Record<string, number>;
  ctx: CellContext;
  depth: number;
  selected: boolean;
  onToggleSelected: (taskId: string, checked: boolean) => void;
  onOpen: (taskId: string) => void;
}) {
  return (
    <div
      className={cn(
        "flex h-8 items-stretch border-b border-border/40 text-sm",
        selected ? "bg-primary/5" : "hover:bg-muted/40",
      )}
    >
      <div className="flex shrink-0 items-center justify-center" style={{ width: SELECT_COLUMN_WIDTH }}>
        <Checkbox
          checked={selected}
          onCheckedChange={(checked) => onToggleSelected(task.id, checked === true)}
        />
      </div>
      {columns.map((column) => (
        <div
          key={column.id}
          className="flex shrink-0 items-center overflow-hidden"
          style={{ width: widths[column.id] ?? column.width }}
        >
          <Cell column={column} task={task} ctx={ctx} depth={depth} onOpen={onOpen} />
        </div>
      ))}
    </div>
  );
});

function Cell({
  column,
  task,
  ctx,
  depth,
  onOpen,
}: {
  column: ColumnDef;
  task: TaskRow;
  ctx: CellContext;
  depth: number;
  onOpen: (taskId: string) => void;
}) {
  switch (column.id) {
    case "priority":
      return <PriorityCell task={task} ctx={ctx} />;
    case "title":
      return <TitleCell task={task} ctx={ctx} depth={depth} onOpen={onOpen} />;
    case "status":
      return <StatusCell task={task} ctx={ctx} />;
    case "project":
      return <ProjectCell task={task} ctx={ctx} />;
    case "assignees":
      return <AssigneesCell task={task} ctx={ctx} />;
    case "tags":
      return <TagsCell task={task} ctx={ctx} />;
    case "due_date":
      return <DueCell task={task} ctx={ctx} />;
    case "estimated_minutes":
      return <EstimateCell task={task} ctx={ctx} />;
    case "subtasks":
      return <SubtasksCell task={task} />;
    case "comments":
      return <CommentsCell task={task} />;
    case "created_at":
      return <PlainDateCell iso={task.created_at} />;
    case "updated_at":
      return <PlainDateCell iso={task.updated_at} />;
    default:
      return <CustomFieldCell value={task.field_values[column.id.replace(/^field:/, "")]} />;
  }
}

// --- Группа -------------------------------------------------------------------------

function GroupBody({
  node,
  level,
  columns,
  widths,
  ctx,
  selected,
  onToggleSelected,
  onSelectMany,
  collapsed,
  onToggleCollapsed,
  onOpen,
  grouped,
}: {
  node: GroupNode;
  level: number;
  columns: ColumnDef[];
  widths: Record<string, number>;
  ctx: CellContext;
  selected: ReadonlySet<string>;
  onToggleSelected: (taskId: string, checked: boolean) => void;
  onSelectMany: (taskIds: string[], checked: boolean) => void;
  collapsed: ReadonlySet<string>;
  onToggleCollapsed: (key: string) => void;
  onOpen: (taskId: string) => void;
  grouped: boolean;
}) {
  const [limit, setLimit] = useState(GROUP_PAGE);
  const isCollapsed = collapsed.has(node.path);
  const rows = node.children.length === 0 ? node.tasks : [];
  const shown = rows.length > limit ? rows.slice(0, limit) : rows;
  const rest = rows.length - shown.length;
  const allSelected = node.tasks.length > 0 && node.tasks.every((t) => selected.has(t.id));

  return (
    <div>
      {grouped && (
        <div
          className={cn(
            "sticky z-10 flex h-8 items-center gap-2 border-b border-border/60 bg-muted/50 px-2 backdrop-blur",
            level === 0 ? "top-8" : "top-16",
          )}
        >
          <button
            onClick={() => onToggleCollapsed(node.path)}
            className="flex min-w-0 items-center gap-1.5 text-left"
          >
            {isCollapsed ? (
              <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
            ) : (
              <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
            )}
            {node.label.color && (
              <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: node.label.color }} />
            )}
            <span className={cn("truncate text-xs font-semibold", level > 0 && "text-muted-foreground")}>
              {node.label.text}
            </span>
            <span className="shrink-0 rounded bg-background px-1.5 text-[10px] font-medium tabular-nums text-muted-foreground">
              {node.tasks.length}
            </span>
          </button>
          <button
            onClick={() => onSelectMany(node.tasks.map((t) => t.id), !allSelected)}
            className="ml-auto shrink-0 rounded px-1.5 text-[11px] text-muted-foreground opacity-0 transition-opacity hover:bg-background hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
          >
            {allSelected ? "снять выбор" : "выбрать все"}
          </button>
        </div>
      )}

      {!isCollapsed && (
        <>
          {node.children.map((child) => (
            <GroupBody
              key={child.path}
              node={child}
              level={level + 1}
              columns={columns}
              widths={widths}
              ctx={ctx}
              selected={selected}
              onToggleSelected={onToggleSelected}
              onSelectMany={onSelectMany}
              collapsed={collapsed}
              onToggleCollapsed={onToggleCollapsed}
              onOpen={onOpen}
              grouped
            />
          ))}
          {shown.map((task) => (
            <Row
              key={task.id}
              task={task}
              columns={columns}
              widths={widths}
              ctx={ctx}
              depth={0}
              selected={selected.has(task.id)}
              onToggleSelected={onToggleSelected}
              onOpen={onOpen}
            />
          ))}
          {rest > 0 && (
            <button
              onClick={() => setLimit((l) => l + GROUP_PAGE)}
              className="w-full border-b border-border/40 py-1.5 text-xs text-muted-foreground hover:bg-muted/60 hover:text-foreground"
            >
              Показать ещё {Math.min(GROUP_PAGE, rest)} · осталось {rest}
            </button>
          )}
        </>
      )}
    </div>
  );
}

// --- Таблица ------------------------------------------------------------------------

export function TaskTable(props: TaskTableProps) {
  const {
    tasks,
    columns,
    ctx,
    groupBy,
    matchCtx,
    sort,
    onToggleSort,
    onResize,
    selected,
    onToggleSelected,
    onSelectMany,
    collapsed,
    onToggleCollapsed,
    onOpen,
    labelForGroup,
    groupOrder,
  } = props;

  const widths = useMemo(() => {
    const map: Record<string, number> = {};
    for (const c of columns) map[c.id] = c.width;
    return map;
  }, [columns]);

  const nodes = useMemo(
    () => buildGroups(tasks, groupBy, matchCtx, labelForGroup, groupOrder),
    [tasks, groupBy, matchCtx, labelForGroup, groupOrder],
  );

  const totalWidth = useMemo(
    () => columns.reduce((sum, c) => sum + c.width, SELECT_COLUMN_WIDTH),
    [columns],
  );

  const allSelected = tasks.length > 0 && tasks.every((t) => selected.has(t.id));
  const grouped = groupBy[0] !== "none";

  return (
    <div className="h-full overflow-auto">
      <div style={{ minWidth: totalWidth }}>
        <div className="sticky top-0 z-20 flex h-8 items-stretch border-b border-border bg-background">
          <div className="flex shrink-0 items-center justify-center" style={{ width: SELECT_COLUMN_WIDTH }}>
            <Checkbox
              checked={allSelected}
              onCheckedChange={(checked) => onSelectMany(tasks.map((t) => t.id), checked === true)}
            />
          </div>
          {columns.map((column) => (
            <HeaderCell
              key={column.id}
              column={column}
              width={column.width}
              sort={sort}
              onToggleSort={onToggleSort}
              onResize={onResize}
            />
          ))}
        </div>

        {nodes.map((node) => (
          <GroupBody
            key={node.path}
            node={node}
            level={0}
            columns={columns}
            widths={widths}
            ctx={ctx}
            selected={selected}
            onToggleSelected={onToggleSelected}
            onSelectMany={onSelectMany}
            collapsed={collapsed}
            onToggleCollapsed={onToggleCollapsed}
            onOpen={onOpen}
            grouped={grouped}
          />
        ))}
      </div>
    </div>
  );
}

/** Колонки представления: базовые + кастомные поля организации, в порядке пользователя. */
export function resolveColumns(
  order: string[],
  widths: Record<string, number>,
  customFields: { id: string; name: string }[],
): ColumnDef[] {
  const base = new Map(BASE_COLUMNS.map((c) => [c.id, c]));
  const custom = new Map(
    customFields.map((f) => [
      `field:${f.id}`,
      { id: `field:${f.id}`, label: f.name, width: 140, sortable: false, editable: false } satisfies ColumnDef,
    ]),
  );
  return order
    .map((id) => base.get(id) ?? custom.get(id))
    .filter((c): c is ColumnDef => Boolean(c))
    .map((c) => ({ ...c, width: widths[c.id] ?? c.width }));
}
