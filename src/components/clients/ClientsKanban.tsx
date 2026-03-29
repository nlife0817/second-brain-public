"use client";

import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { useBrainStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import type { ClientFull, ClientStatus } from "@/types";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Trash2, Building2, Users, StickyNote, Link2, GripVertical } from "lucide-react";

import {
  DndContext,
  DragEndEvent,
  DragOverEvent,
  DragStartEvent,
  DragOverlay,
  closestCorners,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

/* -------------------------------------------------------------------------- */
/*  Constants                                                                  */
/* -------------------------------------------------------------------------- */

const NONE_COLUMN_ID = "__none__";

/* -------------------------------------------------------------------------- */
/*  Status dot                                                                 */
/* -------------------------------------------------------------------------- */

function StatusDot({ color }: { color: string }) {
  return (
    <span
      className="size-2.5 rounded-full shrink-0"
      style={{ backgroundColor: color }}
    />
  );
}

/* -------------------------------------------------------------------------- */
/*  Inline status dropdown (portal-based)                                      */
/* -------------------------------------------------------------------------- */

function InlineStatusDropdown({
  currentStatusId,
  statuses,
  onCommit,
  onCancel,
  anchorRef,
}: {
  currentStatusId: string | null;
  statuses: ClientStatus[];
  onCommit: (statusId: string | null) => void;
  onCancel: () => void;
  anchorRef: React.RefObject<HTMLElement | null>;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    const anchor = anchorRef?.current;
    if (anchor) {
      const rect = anchor.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom;
      const top = spaceBelow < 200 ? rect.top - 8 : rect.bottom + 4;
      setPos({ top, left: rect.left });
    }
  }, [anchorRef]);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onCancel();
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onCancel]);

  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
      }
    }
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onCancel]);

  if (!pos) return null;

  const openUp = pos.top > window.innerHeight / 2;

  const options: { id: string | null; name: string; color: string }[] = [
    { id: null, name: "\u0411\u0435\u0437 \u0441\u0442\u0430\u0442\u0443\u0441\u0430", color: "#94a3b8" },
    ...statuses.map((s) => ({ id: s.id as string | null, name: s.name, color: s.color })),
  ];

  return createPortal(
    <div
      ref={ref}
      style={{
        position: "fixed",
        top: openUp ? undefined : pos.top,
        bottom: openUp ? window.innerHeight - pos.top + 4 : undefined,
        left: pos.left,
        zIndex: 9999,
      }}
      className="min-w-[140px] max-h-[200px] overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 shadow-xl"
      onClick={(e) => e.stopPropagation()}
    >
      {options.map((opt) => (
        <button
          key={opt.id ?? "__none__"}
          onClick={(e) => {
            e.stopPropagation();
            onCommit(opt.id);
          }}
          className={cn(
            "flex w-full items-center gap-2 px-3 py-1.5 text-[11px] hover:bg-slate-50 text-left",
            opt.id === currentStatusId && "bg-violet-50 text-violet-700 font-medium"
          )}
        >
          <span
            className="size-2 rounded-full shrink-0"
            style={{ backgroundColor: opt.color }}
          />
          {opt.name}
        </button>
      ))}
    </div>,
    document.body
  );
}

/* -------------------------------------------------------------------------- */
/*  Card content (shared between real card and overlay ghost)                   */
/* -------------------------------------------------------------------------- */

function CardContent({
  client,
  onOpen,
  onDelete,
  isDragging,
  isDragOverlay,
  dragHandleProps,
}: {
  client: ClientFull;
  onOpen?: (id: string) => void;
  onDelete?: (id: string) => void;
  isDragging?: boolean;
  isDragOverlay?: boolean;
  dragHandleProps?: Record<string, unknown>;
}) {
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [editingStatus, setEditingStatus] = useState(false);
  const statusBadgeRef = useRef<HTMLButtonElement>(null);

  const updateClient = useBrainStore((s) => s.updateClient);
  const clientStatuses = useBrainStore((s) => s.clientStatuses);

  const handleDelete = useCallback(() => {
    onDelete?.(client.id);
    setConfirmingDelete(false);
  }, [client.id, onDelete]);

  const handleStatusChange = useCallback(
    async (statusId: string | null) => {
      setEditingStatus(false);
      await updateClient(client.id, { status_id: statusId });
    },
    [client.id, updateClient]
  );

  const companiesText =
    client.companies.length > 0
      ? client.companies.map((c) => c.name).join(", ")
      : null;

  return (
    <div
      className={cn(
        "group/card relative rounded-xl border bg-white p-3 shadow-sm",
        "border-slate-200",
        "transition-shadow duration-200 ease-out",
        "hover:shadow-md hover:border-slate-300 hover:-translate-y-0.5",
        isDragOverlay && "shadow-2xl shadow-black/10 border-slate-300 ring-1 ring-black/5 rotate-[2deg] scale-105",
        isDragging && !isDragOverlay && "opacity-40 shadow-none scale-[0.98]",
      )}
      onClick={() => onOpen?.(client.id)}
    >
      {/* Drag handle */}
      {dragHandleProps && (
        <div
          className={cn(
            "absolute -left-0.5 top-1/2 -translate-y-1/2 opacity-0 transition-opacity duration-150",
            "group-hover/card:opacity-40 hover:!opacity-80",
          )}
          {...dragHandleProps}
          onClick={(e) => e.stopPropagation()}
        >
          <GripVertical className="size-3.5 text-slate-400" />
        </div>
      )}

      {/* Delete button */}
      {onDelete && (
        <div className="absolute top-2 right-2 opacity-0 group-hover/card:opacity-100 transition-opacity">
          {confirmingDelete ? (
            <div
              className="flex items-center gap-1"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                onClick={handleDelete}
                className="text-[10px] font-medium text-red-500 hover:text-red-700"
              >
                {"\u0414\u0430"}
              </button>
              <span className="text-slate-300">/</span>
              <button
                onClick={() => setConfirmingDelete(false)}
                className="text-[10px] text-slate-400 hover:text-slate-600"
              >
                {"\u041d\u0435\u0442"}
              </button>
            </div>
          ) : (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setConfirmingDelete(true);
              }}
              className="inline-flex items-center justify-center size-5 rounded hover:bg-red-50 text-slate-400 hover:text-red-500 transition-colors"
            >
              <Trash2 className="size-3" />
            </button>
          )}
        </div>
      )}

      {/* Name */}
      <p className="text-sm font-medium text-slate-900 truncate pr-6">
        {client.name}
      </p>

      {/* Status badge (inline editable) */}
      {client.status && (
        <div className="mt-1.5 relative">
          <button
            ref={statusBadgeRef}
            onClick={(e) => {
              e.stopPropagation();
              setEditingStatus(true);
            }}
            className="cursor-pointer"
          >
            <Badge
              variant="secondary"
              className="h-[18px] px-1.5 text-[10px] font-medium rounded-md border-0 cursor-pointer hover:opacity-80 transition-opacity"
              style={{
                backgroundColor: `${client.status.color}18`,
                color: client.status.color,
              }}
            >
              {client.status.name}
            </Badge>
          </button>

          {editingStatus && (
            <InlineStatusDropdown
              currentStatusId={client.status_id}
              statuses={clientStatuses}
              onCommit={handleStatusChange}
              onCancel={() => setEditingStatus(false)}
              anchorRef={statusBadgeRef}
            />
          )}
        </div>
      )}

      {/* No status - show a faint "add status" hint */}
      {!client.status && (
        <div className="mt-1.5 relative">
          <button
            ref={statusBadgeRef}
            onClick={(e) => {
              e.stopPropagation();
              setEditingStatus(true);
            }}
            className="cursor-pointer"
          >
            <Badge
              variant="secondary"
              className="h-[18px] px-1.5 text-[10px] font-medium rounded-md border-0 cursor-pointer text-slate-400 bg-slate-100 hover:bg-slate-200 transition-colors"
            >
              {"\u0411\u0435\u0437 \u0441\u0442\u0430\u0442\u0443\u0441\u0430"}
            </Badge>
          </button>

          {editingStatus && (
            <InlineStatusDropdown
              currentStatusId={client.status_id}
              statuses={clientStatuses}
              onCommit={handleStatusChange}
              onCancel={() => setEditingStatus(false)}
              anchorRef={statusBadgeRef}
            />
          )}
        </div>
      )}

      {/* Companies */}
      {companiesText && (
        <div className="flex items-center gap-1 mt-1.5">
          <Building2 className="size-3 text-slate-400 shrink-0" />
          <span className="text-[11px] text-slate-500 truncate">
            {companiesText}
          </span>
        </div>
      )}

      {/* Counters row */}
      {(client.contacts.length > 0 ||
        client.notes.length > 0 ||
        client.links.length > 0) && (
        <div className="flex items-center gap-3 mt-2">
          {client.contacts.length > 0 && (
            <div className="flex items-center gap-0.5">
              <Users className="size-3 text-slate-400" />
              <span className="text-[10px] tabular-nums text-slate-500">
                {client.contacts.length}
              </span>
            </div>
          )}
          {client.notes.length > 0 && (
            <div className="flex items-center gap-0.5">
              <StickyNote className="size-3 text-slate-400" />
              <span className="text-[10px] tabular-nums text-slate-500">
                {client.notes.length}
              </span>
            </div>
          )}
          {client.links.length > 0 && (
            <div className="flex items-center gap-0.5">
              <Link2 className="size-3 text-slate-400" />
              <span className="text-[10px] tabular-nums text-slate-500">
                {client.links.length}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Sortable card wrapper                                                      */
/* -------------------------------------------------------------------------- */

function SortableClientCard({
  client,
  onOpen,
  onDelete,
}: {
  client: ClientFull;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: client.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  if (isDragging) {
    // Placeholder while dragging
    return (
      <div
        ref={setNodeRef}
        style={style}
        className="rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 p-3 opacity-40"
      >
        <p className="text-sm font-medium text-slate-400 truncate">
          {client.name}
        </p>
      </div>
    );
  }

  return (
    <div ref={setNodeRef} style={style}>
      <CardContent
        client={client}
        onOpen={onOpen}
        onDelete={onDelete}
        dragHandleProps={{ ...attributes, ...listeners }}
      />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Droppable kanban column                                                    */
/* -------------------------------------------------------------------------- */

function KanbanColumn({
  status,
  clients,
  onOpen,
  onDelete,
}: {
  status: ClientStatus | null;
  clients: ClientFull[];
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const columnId = status?.id ?? NONE_COLUMN_ID;
  const { setNodeRef, isOver } = useDroppable({ id: columnId });

  const clientIds = useMemo(() => clients.map((c) => c.id), [clients]);

  return (
    <div className="flex flex-col w-[280px] min-w-[280px] shrink-0">
      {/* Column header */}
      <div className="flex items-center gap-2 px-2 py-2.5 mb-1">
        {status ? (
          <StatusDot color={status.color} />
        ) : (
          <span className="size-2.5 rounded-full shrink-0 bg-slate-300" />
        )}
        <span className="text-xs font-semibold text-slate-700 truncate">
          {status ? status.name : "\u0411\u0435\u0437 \u0441\u0442\u0430\u0442\u0443\u0441\u0430"}
        </span>
        <span className="ml-auto rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-slate-500">
          {clients.length}
        </span>
      </div>

      {/* Cards */}
      <div
        ref={setNodeRef}
        className={cn(
          "flex-1 rounded-lg transition-colors px-1",
          isOver && "bg-slate-100/60"
        )}
      >
        <ScrollArea className="flex-1">
          <SortableContext items={clientIds} strategy={verticalListSortingStrategy}>
            <div className="flex flex-col gap-2 pb-4 min-h-[60px]">
              {clients.map((client) => (
                <SortableClientCard
                  key={client.id}
                  client={client}
                  onOpen={onOpen}
                  onDelete={onDelete}
                />
              ))}
              {clients.length === 0 && (
                <div className="rounded-lg border border-dashed border-slate-200 py-8 text-center">
                  <span className="text-[11px] text-slate-400">
                    {"\u041f\u0443\u0441\u0442\u043e"}
                  </span>
                </div>
              )}
            </div>
          </SortableContext>
        </ScrollArea>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Helpers                                                                    */
/* -------------------------------------------------------------------------- */

type ColumnsMap = Map<string, ClientFull[]>;

function buildColumnsMap(
  clients: ClientFull[],
  statuses: ClientStatus[]
): ColumnsMap {
  const map: ColumnsMap = new Map();
  map.set(NONE_COLUMN_ID, []);
  for (const s of statuses) {
    map.set(s.id, []);
  }
  for (const c of clients) {
    const key = c.status_id ?? NONE_COLUMN_ID;
    if (map.has(key)) {
      map.get(key)!.push(c);
    } else {
      map.get(NONE_COLUMN_ID)!.push(c);
    }
  }
  // Sort each column by position
  for (const [, list] of map) {
    list.sort((a, b) => a.position - b.position);
  }
  return map;
}

/** Find which column a client id belongs to */
function findColumnOfClient(
  columns: ColumnsMap,
  clientId: string
): string | null {
  for (const [columnId, list] of columns) {
    if (list.some((c) => c.id === clientId)) {
      return columnId;
    }
  }
  return null;
}

/* -------------------------------------------------------------------------- */
/*  Main kanban                                                                */
/* -------------------------------------------------------------------------- */

export function ClientsKanban({
  clients,
  onOpen,
  onDelete,
}: {
  clients: ClientFull[];
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const clientStatuses = useBrainStore((s) => s.clientStatuses);
  const reorderClients = useBrainStore((s) => s.reorderClients);

  // Optimistic local state for columns during drag
  const [columns, setColumns] = useState<ColumnsMap>(() =>
    buildColumnsMap(clients, clientStatuses)
  );
  const [activeId, setActiveId] = useState<string | null>(null);

  // Keep a ref to know if we're mid-drag so we don't overwrite optimistic state
  const isDraggingRef = useRef(false);

  // Re-sync local state when props/statuses change (but not during a drag)
  const prevClientsRef = useRef(clients);
  const prevStatusesRef = useRef(clientStatuses);
  if (
    !isDraggingRef.current &&
    (clients !== prevClientsRef.current ||
      clientStatuses !== prevStatusesRef.current)
  ) {
    prevClientsRef.current = clients;
    prevStatusesRef.current = clientStatuses;
    // We set the state lazily; React will batch this
    setColumns(buildColumnsMap(clients, clientStatuses));
  }

  // Active client for the drag overlay
  const activeClient = useMemo(() => {
    if (!activeId) return null;
    return clients.find((c) => c.id === activeId) ?? null;
  }, [activeId, clients]);

  // Sensors
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 5 },
    })
  );

  /* ---- DnD handlers ---- */

  const handleDragStart = useCallback((event: DragStartEvent) => {
    isDraggingRef.current = true;
    setActiveId(String(event.active.id));
  }, []);

  const handleDragOver = useCallback(
    (event: DragOverEvent) => {
      const { active, over } = event;
      if (!over) return;

      const activeIdStr = String(active.id);
      const overIdStr = String(over.id);

      setColumns((prev) => {
        const sourceColumnId = findColumnOfClient(prev, activeIdStr);
        if (!sourceColumnId) return prev;

        // Determine target column: could be a column id or a card id
        let targetColumnId: string | null = null;
        if (prev.has(overIdStr)) {
          // Dropped over a column directly
          targetColumnId = overIdStr;
        } else {
          // Dropped over a card — find its column
          targetColumnId = findColumnOfClient(prev, overIdStr);
        }
        if (!targetColumnId) return prev;

        // Same column — no cross-column move needed in dragOver
        if (sourceColumnId === targetColumnId) return prev;

        // Move the card from source to target column
        const sourceList = [...prev.get(sourceColumnId)!];
        const targetList = [...prev.get(targetColumnId)!];

        const activeIndex = sourceList.findIndex(
          (c) => c.id === activeIdStr
        );
        if (activeIndex === -1) return prev;

        const [movedClient] = sourceList.splice(activeIndex, 1);

        // Find insert index in target: if over a card, insert at that position
        const overIndex = targetList.findIndex((c) => c.id === overIdStr);
        if (overIndex >= 0) {
          targetList.splice(overIndex, 0, movedClient);
        } else {
          targetList.push(movedClient);
        }

        const next = new Map(prev);
        next.set(sourceColumnId, sourceList);
        next.set(targetColumnId, targetList);
        return next;
      });
    },
    []
  );

  /** Commit the current columns map to the backend via reorderClients.
   *  Uses a ref so it's always stable and can be called from state updaters. */
  const reorderClientsRef = useRef(reorderClients);
  reorderClientsRef.current = reorderClients;

  const commitReorder = useCallback((cols: ColumnsMap) => {
    const updates: { id: string; position: number; status_id?: string }[] = [];

    for (const [columnId, list] of cols) {
      list.forEach((client, index) => {
        const statusChanged =
          columnId === NONE_COLUMN_ID
            ? client.status_id !== null
            : client.status_id !== columnId;
        const positionChanged = client.position !== index;

        if (statusChanged || positionChanged) {
          updates.push({
            id: client.id,
            position: index,
            ...(statusChanged
              ? {
                  status_id:
                    columnId === NONE_COLUMN_ID ? undefined : columnId,
                }
              : {}),
          });
        }
      });
    }

    if (updates.length > 0) {
      reorderClientsRef.current(updates);
    }
  }, []);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      isDraggingRef.current = false;
      setActiveId(null);

      if (!over) return;

      const activeIdStr = String(active.id);
      const overIdStr = String(over.id);

      setColumns((prev) => {
        const sourceColumnId = findColumnOfClient(prev, activeIdStr);
        if (!sourceColumnId) return prev;

        // If over a column directly
        let targetColumnId: string | null = null;
        if (prev.has(overIdStr)) {
          targetColumnId = overIdStr;
        } else {
          targetColumnId = findColumnOfClient(prev, overIdStr);
        }
        if (!targetColumnId) return prev;

        // Same column — handle reorder
        if (sourceColumnId === targetColumnId) {
          const list = [...prev.get(sourceColumnId)!];
          const oldIndex = list.findIndex((c) => c.id === activeIdStr);
          const newIndex = list.findIndex((c) => c.id === overIdStr);

          if (oldIndex === -1 || newIndex === -1 || oldIndex === newIndex) {
            // Nothing changed — still commit positions for consistency
            commitReorder(prev);
            return prev;
          }

          const reordered = arrayMove(list, oldIndex, newIndex);
          const next = new Map(prev);
          next.set(sourceColumnId, reordered);
          commitReorder(next);
          return next;
        }

        // Cross-column: the move was already handled in dragOver,
        // just commit the current state
        commitReorder(prev);
        return prev;
      });
    },
    [commitReorder]
  );

  const handleDragCancel = useCallback(() => {
    isDraggingRef.current = false;
    setActiveId(null);
    // Reset to props state
    setColumns(buildColumnsMap(clients, clientStatuses));
  }, [clients, clientStatuses]);

  // Determine which columns to render
  const columnEntries = useMemo(() => {
    const entries: { status: ClientStatus | null; clients: ClientFull[] }[] =
      [];

    // "No status" column — always show if there are cards (or always show for drop target)
    const noneClients = columns.get(NONE_COLUMN_ID) ?? [];
    entries.push({ status: null, clients: noneClients });

    // Status columns in order
    for (const s of clientStatuses) {
      entries.push({
        status: s,
        clients: columns.get(s.id) ?? [],
      });
    }

    return entries;
  }, [columns, clientStatuses]);

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <div className="flex-1 overflow-x-auto">
        <div className="flex gap-3 p-4 min-h-full">
          {columnEntries.map(({ status, clients: colClients }) => (
            <KanbanColumn
              key={status?.id ?? NONE_COLUMN_ID}
              status={status}
              clients={colClients}
              onOpen={onOpen}
              onDelete={onDelete}
            />
          ))}
        </div>
      </div>

      {/* Drag overlay ghost card */}
      <DragOverlay dropAnimation={{ duration: 150, easing: "ease-out" }}>
        {activeClient ? (
          <div className="w-[256px]">
            <CardContent client={activeClient} isDragOverlay />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
