"use client";

// Дерево документов в левой колонке раздела.
//
// Отдельная колонка, а не ветка сайдбара: вложенность здесь многоуровневая, и в
// панели с проектами она отняла бы место у списка задач.
//
// Перетаскивание умеет три вещи, и все три — один жест: сменить порядок среди
// соседей, вложить документ в другой (в том числе в другую ветку) и перенести
// корень между разделами. Зона решается по вертикали строки: верхняя и нижняя
// четверти — «перед»/«после», середина — «внутрь». Порядок разделов — это
// порядок проектов в боковой панели: он один на организацию.

import { memo, useCallback, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  DndContext,
  PointerSensor,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragMoveEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  ChevronRight,
  FileText,
  Folder,
  FolderOpen,
  Globe,
  GripVertical,
  Plus,
  Table2,
  Trash2,
  Upload,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ProjectIcon } from "@/components/v2/project-icons";
import type { KbNodeKind, KbTreeGroup, KbTreeNode, ProjectWithMeta } from "@/lib/core/types";
import { cn } from "@/lib/utils";

/** Что заводим: страницу, таблицу, раздел — или переносим готовый файл. */
function CreateMenu({
  trigger,
  onCreate,
  onUpload,
}: {
  trigger: React.ReactElement;
  onCreate: (kind: KbNodeKind) => void;
  onUpload: (file: File) => void;
}) {
  // Поле выбора файла спрятано, но живёт рядом с меню: одно на каждую точку
  // создания, поэтому загруженное попадает ровно туда, где нажали «плюс».
  const input = useRef<HTMLInputElement | null>(null);
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger render={trigger} />
        <DropdownMenuContent align="start">
          <DropdownMenuItem onClick={() => onCreate("document")}>
            <FileText className="size-4" />
            Документ
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => onCreate("sheet")}>
            <Table2 className="size-4" />
            Таблица
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => onCreate("folder")}>
            <Folder className="size-4" />
            Папка
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => input.current?.click()}>
            <Upload className="size-4" />
            Загрузить файл…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <input
        ref={input}
        type="file"
        accept=".docx,.xlsx,.xlsm,.csv,.tsv"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          // Значение сбрасываем сразу: без этого повторный выбор того же файла
          // не вызовет `change`, и кнопка будет выглядеть сломанной.
          event.target.value = "";
          if (file) onUpload(file);
        }}
      />
    </>
  );
}

/** Раздел «Общие» — документы без проектов. Ключ отличается от uuid проекта. */
export const COMMON_GROUP = "common";

export type GroupKey = string;

/** Куда именно ляжет документ, если отпустить его сейчас. */
type DropZone = "before" | "after" | "inside";

interface DropTarget {
  /** Узел, относительно которого считается зона; `null` — конец раздела. */
  nodeId: string | null;
  groupKey: GroupKey;
  zone: DropZone;
}

export interface KbMoveRequest {
  documentId: string;
  parentId: string | null;
  /** Проект раздела, куда кладём корень; `null` — «Общие». */
  projectId: string | null;
  /** Раздел, из которого тащили: у корня в двух проектах снимается только он. */
  fromProjectId: string | null;
  /** Полный порядок соседей после переноса; пусто — просто в конец. */
  order: string[];
  /** Родитель и раздел не изменились — достаточно перестановки. */
  reorderOnly: boolean;
}

/** Плоский индекс дерева: по нему считаются соседи и путь перетаскивания. */
interface FlatNode {
  node: KbTreeNode;
  groupKey: GroupKey;
  parentId: string | null;
  depth: number;
}

function flatten(groups: KbTreeGroup[]): Map<string, FlatNode[]> {
  const byGroup = new Map<string, FlatNode[]>();
  for (const group of groups) {
    const key = group.project_id ?? COMMON_GROUP;
    const out: FlatNode[] = [];
    const walk = (nodes: KbTreeNode[], parentId: string | null, depth: number) => {
      for (const node of nodes) {
        out.push({ node, groupKey: key, parentId, depth });
        walk(node.children, node.id, depth + 1);
      }
    };
    walk(group.nodes, null, 0);
    byGroup.set(key, out);
  }
  return byGroup;
}

function DropLine({ visible }: { visible: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "pointer-events-none absolute inset-x-1 h-0.5 rounded-full bg-primary transition-opacity",
        visible ? "opacity-100" : "opacity-0",
      )}
    />
  );
}

const Row = memo(function Row({
  node,
  depth,
  groupKey,
  parentId,
  activeId,
  drop,
  expanded,
  hasChildren,
  isActiveDoc,
  canEdit,
  onToggle,
  onCreateChild,
  onUploadInto,
}: {
  node: KbTreeNode;
  depth: number;
  groupKey: GroupKey;
  parentId: string | null;
  activeId: string | null;
  drop: DropTarget | null;
  expanded: boolean;
  hasChildren: boolean;
  isActiveDoc: boolean;
  canEdit: boolean;
  onToggle: (id: string) => void;
  onCreateChild: (id: string, kind: KbNodeKind) => void;
  onUploadInto: (id: string, file: File) => void;
}) {
  // Один и тот же элемент и берут, и на него бросают: у строки нет отдельной
  // ручки — тащат её целиком, как карточку на доске.
  const draggable = useDraggable({
    id: `${groupKey}:${node.id}`,
    data: { nodeId: node.id, groupKey, parentId, kind: node.kind },
    disabled: !canEdit,
  });
  const droppable = useDroppable({
    id: `${groupKey}:${node.id}`,
    data: { nodeId: node.id, groupKey, parentId, kind: node.kind },
  });

  const dragging = activeId === node.id;
  const folder = node.kind === "folder";
  const target = drop?.nodeId === node.id && drop.groupKey === groupKey ? drop.zone : null;
  const Icon = folder ? (expanded ? FolderOpen : Folder) : node.kind === "sheet" ? Table2 : FileText;

  return (
    <div className="relative">
      {target === "before" && <DropLine visible />}
      <div
        ref={(el) => {
          draggable.setNodeRef(el);
          droppable.setNodeRef(el);
        }}
        {...draggable.listeners}
        {...draggable.attributes}
        style={{ paddingLeft: 8 + depth * 14 }}
        className={cn(
          "group/kb relative flex items-center gap-1 rounded-lg py-1 pr-1 text-sm transition-colors",
          // touch-none обязателен: без него палец прокручивает колонку вместо
          // перетаскивания.
          canEdit && "cursor-grab touch-none",
          dragging && "opacity-40",
          target === "inside" && "bg-primary/15 ring-1 ring-primary",
          isActiveDoc
            ? "bg-primary/10 font-medium text-primary"
            : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
        )}
      >
        <button
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onToggle(node.id);
          }}
          className={cn(
            "grid size-4 shrink-0 place-items-center rounded text-muted-foreground",
            !hasChildren && "invisible",
          )}
          aria-label={expanded ? "Свернуть" : "Развернуть"}
          aria-expanded={expanded}
        >
          <ChevronRight className={cn("size-3 transition-transform", expanded && "rotate-90")} />
        </button>
        <Icon className={cn("size-3.5 shrink-0", folder && "text-primary/70")} />
        {/* Ссылка внутри перетаскиваемой строки: dnd-kit гасит клик только
            после настоящего жеста, поэтому обычный переход работает. */}
        <Link
          href={`/v2/kb/${node.id}`}
          className="min-w-0 flex-1 truncate py-0.5"
          draggable={false}
          title={node.title || "Без названия"}
        >
          {node.title || "Без названия"}
        </Link>
        {canEdit && folder && (
          // Класть внутрь можно только в папку — у документа кнопки нет вовсе.
          <CreateMenu
            onCreate={(kind) => onCreateChild(node.id, kind)}
            onUpload={(file) => onUploadInto(node.id, file)}
            trigger={
              <button
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                }}
                className="hidden shrink-0 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground group-hover/kb:block data-[popup-open]:block"
                title="Создать внутри"
                aria-label={`Создать внутри «${node.title}»`}
              >
                <Plus className="size-3.5" />
              </button>
            }
          />
        )}
      </div>
      {target === "after" && <DropLine visible />}
    </div>
  );
});

/** Шапка раздела. У проектов её ещё и перетаскивают — это порядок панели. */
function GroupHead({
  groupKey,
  project,
  canOrderProjects,
  canCreate,
  onCreate,
  onUpload,
  dropping,
}: {
  groupKey: GroupKey;
  project: ProjectWithMeta | null;
  canOrderProjects: boolean;
  canCreate: boolean;
  onCreate: (kind: KbNodeKind) => void;
  onUpload: (file: File) => void;
  dropping: boolean;
}) {
  const draggable = useDraggable({
    id: `head:${groupKey}`,
    data: { groupHead: groupKey },
    disabled: !project || !canOrderProjects,
  });
  const droppable = useDroppable({ id: `head:${groupKey}`, data: { groupHead: groupKey } });

  return (
    <div
      ref={(el) => {
        draggable.setNodeRef(el);
        droppable.setNodeRef(el);
      }}
      className={cn(
        "group/head mt-3 flex items-center gap-1.5 rounded-lg px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground",
        dropping && "bg-primary/10 ring-1 ring-primary",
      )}
    >
      {project && canOrderProjects && (
        <button
          {...draggable.listeners}
          {...draggable.attributes}
          className="hidden shrink-0 cursor-grab touch-none text-muted-foreground group-hover/head:block"
          title="Перетащите, чтобы изменить порядок. Он общий с боковой панелью"
          aria-label={`Переместить проект «${project.name}»`}
        >
          <GripVertical className="size-3.5" />
        </button>
      )}
      {project ? (
        <ProjectIcon name={project.icon} color={project.color} className="size-3.5" />
      ) : (
        <Globe className="size-3.5" />
      )}
      <span className="min-w-0 flex-1 truncate">{project ? project.name : "Общие"}</span>
      {canCreate && (
        <CreateMenu
          onCreate={onCreate}
          onUpload={onUpload}
          trigger={
            <button
              className="shrink-0 rounded p-0.5 hover:bg-muted hover:text-foreground"
              title={project ? `Создать в проекте «${project.name}»` : "Создать в «Общих»"}
              aria-label={project ? `Создать в проекте «${project.name}»` : "Создать в «Общих»"}
            >
              <Plus className="size-3.5" />
            </button>
          }
        />
      )}
    </div>
  );
}

export function KbTree({
  groups,
  filterLabel,
  projects,
  activeDocumentId,
  canOrderProjects,
  canCreateCommon,
  onMove,
  onReorderProjects,
  onCreate,
  onUpload,
  trashCount,
  hideOnNarrow,
}: {
  groups: KbTreeGroup[];
  /** Раздел сужен до одного проекта — его имя и способ вернуться ко всем. */
  filterLabel: string | null;
  projects: ProjectWithMeta[];
  activeDocumentId: string | null;
  canOrderProjects: boolean;
  canCreateCommon: boolean;
  onMove: (request: KbMoveRequest) => void;
  onReorderProjects: (order: string[]) => void;
  /** `parentId` — вложенный узел, иначе корень раздела. */
  onCreate: (target: {
    parentId: string | null;
    projectId: string | null;
    kind: KbNodeKind;
  }) => void;
  /** Загрузка готового файла в то же место, где заводят узел. */
  onUpload: (target: { parentId: string | null; projectId: string | null }, file: File) => void;
  trashCount: number;
  /**
   * Узкий экран показывает что-то одно: дерево или документ. Мобильных экранов
   * у раздела пока нет, и без этого на телефоне колонка в 264 px не оставляла
   * бы документу ничего.
   */
  hideOnNarrow: boolean;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [query, setQuery] = useState("");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [drop, setDrop] = useState<DropTarget | null>(null);
  // Зону считаем по прямоугольнику перетаскиваемой строки, а он приходит в
  // событии движения; в onDragEnd его уже нет — поэтому держим ref.
  const dropRef = useRef<DropTarget | null>(null);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const flat = useMemo(() => flatten(groups), [groups]);
  const projectById = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects]);

  /**
   * Открытый документ обязан быть видно в дереве: его ветку раскрываем сами —
   * и при переходе по ссылке, и после создания вложенного. Раскрываем один раз
   * на смену документа, а не постоянно, иначе ветку было бы не свернуть.
   */
  const [lastActive, setLastActive] = useState<string | null>(activeDocumentId);
  if (lastActive !== activeDocumentId) {
    setLastActive(activeDocumentId);
    if (activeDocumentId) {
      const chain: string[] = [];
      for (const list of flat.values()) {
        const entry = list.find((n) => n.node.id === activeDocumentId);
        if (!entry) continue;
        let parentId = entry.parentId;
        const guard = new Set<string>();
        while (parentId && !guard.has(parentId)) {
          guard.add(parentId);
          chain.push(parentId);
          parentId = list.find((n) => n.node.id === parentId)?.parentId ?? null;
        }
      }
      if (chain.length > 0) {
        setExpanded((prev) => {
          const next = new Set(prev);
          for (const id of chain) next.add(id);
          return next;
        });
      }
    }
  }

  const toggle = useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  /**
   * Поиск не фильтрует дерево, а раскрывает совпавшие ветки: вырезанное дерево
   * теряет структуру, ради которой раздел и заведён.
   */
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return null;
    const hit = new Set<string>();
    for (const list of flat.values()) {
      for (const { node } of list) {
        if (node.title.toLowerCase().includes(q)) hit.add(node.id);
      }
    }
    return hit;
  }, [query, flat]);

  function onDragStart(event: DragStartEvent) {
    const data = event.active.data.current;
    setActiveId((data?.nodeId as string | undefined) ?? null);
  }

  function onDragMove(event: DragMoveEvent) {
    const over = event.over;
    const rect = event.active.rect.current.translated;
    if (!over || !rect) {
      dropRef.current = null;
      setDrop(null);
      return;
    }
    const headKey = over.data.current?.groupHead as string | undefined;
    if (headKey) {
      const next: DropTarget = { nodeId: null, groupKey: headKey, zone: "after" };
      dropRef.current = next;
      setDrop(next);
      return;
    }
    const nodeId = over.data.current?.nodeId as string | undefined;
    const groupKey = over.data.current?.groupKey as string | undefined;
    if (!nodeId || !groupKey || nodeId === activeId) {
      dropRef.current = null;
      setDrop(null);
      return;
    }
    const center = rect.top + rect.height / 2;
    const above = center < over.rect.top + over.rect.height * 0.25;
    const below = center > over.rect.top + over.rect.height * 0.75;
    // Внутрь принимает только папка: у документа середина строки — это «после»,
    // иначе жест обещал бы вложение, которого не будет.
    const acceptsInside = over.data.current?.kind === "folder";
    const zone: DropZone = above ? "before" : below || !acceptsInside ? "after" : "inside";
    const next: DropTarget = { nodeId, groupKey, zone };
    dropRef.current = next;
    setDrop(next);
  }

  function onDragEnd(event: DragEndEvent) {
    const target = dropRef.current;
    const activeData = event.active.data.current;
    setActiveId(null);
    setDrop(null);
    dropRef.current = null;
    if (!target) return;

    // Перестановка разделов: это порядок проектов организации, общий с панелью.
    const movedHead = activeData?.groupHead as string | undefined;
    if (movedHead) {
      if (movedHead === COMMON_GROUP || target.groupKey === COMMON_GROUP) return;
      const order = groups
        .map((g) => g.project_id)
        .filter((id): id is string => !!id);
      const from = order.indexOf(movedHead);
      const to = order.indexOf(target.groupKey);
      if (from === -1 || to === -1 || from === to) return;
      const next = [...order];
      next.splice(to, 0, next.splice(from, 1)[0]);
      onReorderProjects(next);
      return;
    }

    const documentId = activeData?.nodeId as string | undefined;
    const fromGroup = activeData?.groupKey as string | undefined;
    const fromParent = (activeData?.parentId as string | null | undefined) ?? null;
    if (!documentId || !fromGroup) return;

    const groupList = flat.get(target.groupKey) ?? [];
    const fromProjectId = fromGroup === COMMON_GROUP ? null : fromGroup;
    const projectId = target.groupKey === COMMON_GROUP ? null : target.groupKey;

    // В конец раздела — уронили на его шапку.
    if (!target.nodeId) {
      onMove({
        documentId,
        parentId: null,
        projectId,
        fromProjectId,
        order: [],
        reorderOnly: false,
      });
      return;
    }

    const overEntry = groupList.find((n) => n.node.id === target.nodeId);
    if (!overEntry) return;

    if (target.zone === "inside") {
      onMove({
        documentId,
        parentId: target.nodeId,
        projectId: null,
        fromProjectId,
        order: [],
        reorderOnly: false,
      });
      return;
    }

    const parentId = overEntry.parentId;
    const siblings = groupList
      .filter((n) => n.parentId === parentId)
      .map((n) => n.node.id)
      .filter((id) => id !== documentId);
    const at = siblings.indexOf(target.nodeId);
    const insert = target.zone === "before" ? at : at + 1;
    siblings.splice(insert < 0 ? siblings.length : insert, 0, documentId);

    onMove({
      documentId,
      parentId,
      projectId: parentId ? null : projectId,
      fromProjectId,
      order: siblings,
      reorderOnly: parentId === fromParent && target.groupKey === fromGroup,
    });
  }

  const renderNodes = (list: FlatNode[], parentId: string | null, groupKey: GroupKey) =>
    list
      .filter((n) => n.parentId === parentId)
      .map((entry) => {
        const open = expanded.has(entry.node.id) || (!!matches && hasMatch(entry.node, matches));
        const children = entry.node.children.length > 0;
        return (
          <div key={`${groupKey}:${entry.node.id}`}>
            <Row
              node={entry.node}
              depth={entry.depth}
              groupKey={groupKey}
              parentId={entry.parentId}
              activeId={activeId}
              drop={drop}
              expanded={open}
              hasChildren={children}
              isActiveDoc={activeDocumentId === entry.node.id}
              canEdit
              onToggle={toggle}
              onCreateChild={(id, kind) => onCreate({ parentId: id, projectId: null, kind })}
              onUploadInto={(id, file) => onUpload({ parentId: id, projectId: null }, file)}
            />
            {children && open && <div>{renderNodes(list, entry.node.id, groupKey)}</div>}
          </div>
        );
      });

  return (
    <nav
      className={cn(
        "flex h-full shrink-0 flex-col border-r border-border bg-sidebar",
        "max-md:w-full md:w-[264px]",
        hideOnNarrow && "max-md:hidden",
      )}
    >
      {filterLabel && (
        <div className="flex items-center gap-1.5 px-3 pt-3 text-xs">
          <span className="min-w-0 flex-1 truncate font-medium">{filterLabel}</span>
          <Link href="/v2/kb" className="shrink-0 text-muted-foreground hover:text-foreground">
            все проекты
          </Link>
        </div>
      )}
      <div className="flex items-center gap-1.5 px-2 pb-2 pt-3">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Поиск по базе"
          className="h-8 min-w-0 flex-1 rounded-lg border border-border bg-background px-2.5 text-sm outline-none placeholder:text-muted-foreground focus:border-ring"
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {/* id обязателен: без него dnd-kit нумерует свои aria-describedby
            счётчиком модуля, а он у серверного рендера и у браузера свой —
            React ловит это как расхождение гидрации. Дерево ещё и живёт в
            layout, то есть рендерится на сервере при каждом переходе. */}
        <DndContext
          id="kb-tree"
          sensors={sensors}
          collisionDetection={pointerWithin}
          onDragStart={onDragStart}
          onDragMove={onDragMove}
          onDragEnd={onDragEnd}
          onDragCancel={() => {
            setActiveId(null);
            setDrop(null);
            dropRef.current = null;
          }}
        >
          {/* «Общие» всегда первыми: это не проект, и в порядке проектов ему
              места нет. */}
          {[...flat.entries()].map(([groupKey, list]) => {
            const project = groupKey === COMMON_GROUP ? null : (projectById.get(groupKey) ?? null);
            if (groupKey !== COMMON_GROUP && !project) return null;
            return (
              <div key={groupKey}>
                <GroupHead
                  groupKey={groupKey}
                  project={project}
                  canOrderProjects={canOrderProjects}
                  canCreate={project ? project.my_role === "admin" || project.my_role === "editor" : canCreateCommon}
                  onCreate={(kind) => onCreate({ parentId: null, projectId: project?.id ?? null, kind })}
                  onUpload={(file) => onUpload({ parentId: null, projectId: project?.id ?? null }, file)}
                  dropping={drop?.groupKey === groupKey && drop.nodeId === null}
                />
                <div className="flex flex-col gap-0.5">{renderNodes(list, null, groupKey)}</div>
                {list.length === 0 && (
                  <p className="px-2 py-1 text-xs text-muted-foreground/70">пусто</p>
                )}
              </div>
            );
          })}
        </DndContext>

        {flat.size === 0 && (
          <p className="px-2 py-6 text-xs text-muted-foreground">
            Вам ещё не открыли ни одного проекта, а общих документов нет.
          </p>
        )}
      </div>

      <Link
        href="/v2/kb/trash"
        className="flex items-center gap-2 border-t border-border px-3 py-2 text-sm text-muted-foreground hover:text-foreground"
      >
        <Trash2 className="size-3.5" />
        <span className="flex-1">Корзина</span>
        {trashCount > 0 && <span className="text-xs">{trashCount}</span>}
      </Link>
    </nav>
  );
}

/** Есть ли совпадение поиска в ветке — по нему она раскрывается. */
function hasMatch(node: KbTreeNode, matches: ReadonlySet<string>): boolean {
  if (matches.has(node.id)) return true;
  return node.children.some((child) => hasMatch(child, matches));
}
