"use client";

import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { useBrainStore, useFilteredClients } from "@/lib/store";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import type { ClientFull, ClientGroupByField } from "@/types";
import {
  Search,
  Plus,
  Trash2,
  Users,
  Phone,
  StickyNote,
  Link2,
  Settings,
  LayoutGrid,
  List,
  X,
  Maximize2,
  PanelRight,
  ChevronRight,
  ChevronDown,
  GripVertical,
  Banknote,
  UserCheck,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
} from "@/components/ui/tooltip";
import { StatusManager } from "./StatusManager";
import { ClientsKanban } from "./ClientsKanban";

import {
  DndContext,
  DragEndEvent,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
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

const CLIENT_GROUP_OPTIONS: { key: ClientGroupByField; label: string }[] = [
  { key: "none", label: "Без группировки" },
  { key: "status", label: "Статус" },
  { key: "budget", label: "Бюджет" },
  { key: "operators_per_shift", label: "Оп. в смену" },
  { key: "crm_system", label: "CRM" },
];

/* -------------------------------------------------------------------------- */
/*  Grouping helpers                                                           */
/* -------------------------------------------------------------------------- */

function getBudgetRange(budget: string): string {
  const num = parseInt(budget.replace(/\s/g, ""), 10);
  if (!budget || isNaN(num)) return "Не указан";
  if (num < 30000) return "до 30 000";
  if (num < 100000) return "30 000 — 100 000";
  return "100 000+";
}

function getGroupValue(
  client: ClientFull,
  field: ClientGroupByField
): string {
  switch (field) {
    case "status":
      return client.status?.name ?? "Без статуса";
    case "budget":
      return getBudgetRange(client.budget);
    case "operators_per_shift":
      return client.operators_per_shift || "Не указано";
    case "crm_system":
      return client.crm_system || "Не указана";
    default:
      return "";
  }
}

function getGroupValues(
  client: ClientFull,
  field: ClientGroupByField
): string[] {
  if (field === "crm_system") {
    if (client.crm_systems && client.crm_systems.length > 0) {
      return client.crm_systems.map((c) => c.name);
    }
    return ["Не указана"];
  }
  return [getGroupValue(client, field)];
}

interface ClientGroup {
  key: string;
  label: string;
  items: ClientFull[];
}

function groupClients(
  clients: ClientFull[],
  field: ClientGroupByField,
  clientStatuses?: { id: string; name: string; color: string; position: number }[]
): ClientGroup[] {
  if (field === "none") return [];

  const map = new Map<string, ClientFull[]>();
  for (const client of clients) {
    const keys = getGroupValues(client, field);
    for (const key of keys) {
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(client);
    }
  }

  const groups: ClientGroup[] = [];
  for (const [key, items] of map) {
    groups.push({ key, label: key, items });
  }

  if (field === "status" && clientStatuses) {
    const posMap = new Map<string, number>();
    for (const s of clientStatuses) {
      posMap.set(s.name, s.position);
    }
    groups.sort((a, b) => {
      const noStatus = "Без статуса";
      if (a.label === noStatus && b.label !== noStatus) return 1;
      if (b.label === noStatus && a.label !== noStatus) return -1;
      const aPos = posMap.get(a.label) ?? 9999;
      const bPos = posMap.get(b.label) ?? 9999;
      if (aPos !== bPos) return aPos - bPos;
      return a.label.localeCompare(b.label, "ru");
    });
  } else {
    groups.sort((a, b) => a.label.localeCompare(b.label, "ru"));
  }

  return groups;
}

/* -------------------------------------------------------------------------- */
/*  Shared sub-components                                                      */
/* -------------------------------------------------------------------------- */


/* -------------------------------------------------------------------------- */
/*  InlineSelectCell — portal-based dropdown for inline editing               */
/* -------------------------------------------------------------------------- */

function InlineSelectCell({
  value,
  options,
  onChange,
  renderOption,
  renderValue,
}: {
  value: string;
  options: { key: string; label: string; color?: string }[];
  onChange: (key: string) => void;
  renderOption?: (opt: { key: string; label: string; color?: string }) => React.ReactNode;
  renderValue?: (opt: { key: string; label: string; color?: string } | undefined) => React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  const currentOpt = options.find((o) => o.key === value);

  const handleOpen = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    const anchor = anchorRef.current;
    if (anchor) {
      const rect = anchor.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom;
      const top = spaceBelow < 200 ? rect.top - 8 : rect.bottom + 4;
      setPos({ top, left: rect.left });
    }
    setOpen(true);
  }, []);

  const handleClose = useCallback(() => {
    setOpen(false);
  }, []);

  // Click outside
  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node) &&
        anchorRef.current &&
        !anchorRef.current.contains(e.target as Node)
      ) {
        handleClose();
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open, handleClose]);

  // Escape
  useEffect(() => {
    if (!open) return;
    function handler(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        handleClose();
      }
    }
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, handleClose]);

  const openUp = pos ? pos.top > window.innerHeight / 2 : false;

  return (
    <>
      <div
        ref={anchorRef}
        onClick={handleOpen}
        className="cursor-pointer"
      >
        {renderValue
          ? renderValue(currentOpt)
          : currentOpt
            ? <span className="text-xs">{currentOpt.label}</span>
            : <span className="text-xs text-slate-300">--</span>}
      </div>
      {open &&
        pos &&
        createPortal(
          <div
            ref={dropdownRef}
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
                key={opt.key}
                onClick={(e) => {
                  e.stopPropagation();
                  onChange(opt.key);
                  handleClose();
                }}
                className={cn(
                  "flex w-full items-center px-3 py-1.5 text-[11px] hover:bg-slate-50 text-left gap-2",
                  opt.key === value && "bg-violet-50 text-violet-700 font-medium"
                )}
              >
                {renderOption ? renderOption(opt) : opt.label}
              </button>
            ))}
          </div>,
          document.body
        )}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/*  InlineTextCell — click-to-edit text input                                 */
/* -------------------------------------------------------------------------- */

function InlineTextCell({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);

  const startEditing = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      setDraft(value);
      setEditing(true);
    },
    [value]
  );

  const commit = useCallback(() => {
    setEditing(false);
    const trimmed = draft.trim();
    if (trimmed !== value) {
      onChange(trimmed);
    }
  }, [draft, value, onChange]);

  const cancel = useCallback(() => {
    setEditing(false);
    setDraft(value);
  }, [value]);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          }
          if (e.key === "Escape") {
            e.preventDefault();
            cancel();
          }
        }}
        onClick={(e) => e.stopPropagation()}
        placeholder={placeholder}
        className="h-6 text-[11px] border border-slate-200 bg-white px-1.5 rounded-md w-full outline-none focus:ring-1 focus:ring-violet-300 focus:border-violet-300"
      />
    );
  }

  return (
    <div
      onClick={startEditing}
      className="cursor-pointer min-h-[24px] flex items-center"
    >
      <span
        className={cn(
          "text-xs tabular-nums",
          value ? "text-slate-600" : "text-slate-300"
        )}
      >
        {value || "--"}
      </span>
    </div>
  );
}

function EmptyState({ onCreateClient }: { onCreateClient: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-24 px-6">
      <div className="flex items-center justify-center size-16 rounded-2xl bg-slate-100 mb-5">
        <Users className="size-7 text-slate-400" />
      </div>
      <h3 className="text-base font-semibold text-slate-900 mb-1.5">
        Клиентов пока нет
      </h3>
      <p className="text-sm text-slate-500 text-center max-w-[320px] mb-4">
        Добавьте первого клиента, чтобы начать вести учет контактов, компаний и
        заметок.
      </p>
      <Button variant="default" size="sm" onClick={onCreateClient}>
        <Plus className="size-4 mr-1.5" />
        Добавить клиента
      </Button>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Group section header row                                                   */
/* -------------------------------------------------------------------------- */

function GroupSection({
  group,
  collapsed,
  onToggle,
  colCount,
  depth = 0,
  children,
}: {
  group: ClientGroup;
  collapsed: boolean;
  onToggle: () => void;
  colCount: number;
  depth?: number;
  children: React.ReactNode;
}) {
  const isNested = depth > 0;

  return (
    <>
      <tr
        className={cn(
          "hover:bg-slate-200/60 cursor-pointer transition-colors border-t border-slate-200",
          isNested ? "bg-slate-50/90" : "bg-slate-100/80"
        )}
        onClick={onToggle}
      >
        <td colSpan={colCount} className="px-3 py-2">
          <div
            className="flex items-center gap-2"
            style={{ paddingLeft: isNested ? 20 : 0 }}
          >
            <button
              type="button"
              className="inline-flex items-center justify-center size-4 rounded hover:bg-slate-300/50 transition-colors text-slate-500"
            >
              {collapsed ? (
                <ChevronRight className="size-3.5" />
              ) : (
                <ChevronDown className="size-3.5" />
              )}
            </button>
            <span
              className={cn(
                "font-semibold",
                isNested
                  ? "text-[11px] text-slate-600"
                  : "text-xs text-slate-700"
              )}
            >
              {group.label}
            </span>
            <span className="text-[10px] text-slate-400 tabular-nums">
              {group.items.length}
            </span>
          </div>
        </td>
      </tr>
      {children}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/*  Sortable client row (for list view)                                        */
/* -------------------------------------------------------------------------- */

function SortableClientRow({
  client,
  onOpen,
  onDelete,
  dragDisabled,
  clientStatuses,
}: {
  client: ClientFull;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
  dragDisabled: boolean;
  clientStatuses: { id: string; name: string; color: string; position: number }[];
}) {
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const updateClient = useBrainStore((s) => s.updateClient);

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: client.id,
    animateLayoutChanges: () => false,
  });

  const sortableStyle: React.CSSProperties = {
    transform: CSS.Translate.toString(transform),
    transition: isDragging ? undefined : transition,
  };

  const handleDelete = useCallback(() => {
    onDelete(client.id);
    setConfirmingDelete(false);
  }, [client.id, onDelete]);

  const companiesText =
    client.companies.length > 0
      ? client.companies.map((c) => c.name).join(", ")
      : null;

  /* -- Status options for InlineSelectCell -- */
  const statusOptions = useMemo(() => {
    const opts: { key: string; label: string; color?: string }[] = [
      { key: "__none__", label: "Без статуса", color: "#94a3b8" },
    ];
    for (const s of clientStatuses) {
      opts.push({ key: s.id, label: s.name, color: s.color });
    }
    return opts;
  }, [clientStatuses]);

  const currentStatusKey = client.status?.id ?? "__none__";

  return (
    <tr
      ref={setNodeRef}
      style={sortableStyle}
      className={cn(
        "group hover:bg-slate-50/50 cursor-pointer transition-colors border-b border-slate-100 last:border-b-0",
        isDragging && "opacity-50 bg-slate-50 shadow-sm z-50 relative"
      )}
      onClick={() => onOpen(client.id)}
    >
      {/* Drag handle */}
      <td className="w-8 px-1 py-2.5">
        {!dragDisabled ? (
          <button
            type="button"
            className="inline-flex items-center justify-center size-6 rounded text-slate-300 hover:text-slate-500 hover:bg-slate-100 cursor-grab active:cursor-grabbing opacity-0 group-hover:opacity-100 transition-opacity"
            onClick={(e) => e.stopPropagation()}
            {...attributes}
            {...listeners}
          >
            <GripVertical className="size-3.5" />
          </button>
        ) : (
          <span className="inline-block size-6" />
        )}
      </td>

      {/* Name — click opens detail */}
      <td className="px-4 py-2.5">
        <span className="text-sm text-slate-900 font-medium truncate block max-w-[280px]">
          {client.name}
        </span>
      </td>

      {/* Status — inline select */}
      <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
        <InlineSelectCell
          value={currentStatusKey}
          options={statusOptions}
          onChange={(statusId) =>
            updateClient(client.id, {
              status_id: statusId === "__none__" ? null : statusId,
            })
          }
          renderOption={(opt) => (
            <span className="inline-flex items-center gap-1.5">
              <span
                className="inline-block size-2 rounded-full shrink-0"
                style={{ backgroundColor: opt.color ?? "#94a3b8" }}
              />
              <span>{opt.label}</span>
            </span>
          )}
          renderValue={(opt) =>
            opt && opt.key !== "__none__" ? (
              <Badge
                variant="secondary"
                className="text-[10px] font-medium rounded-md cursor-pointer"
                style={{
                  backgroundColor: `${opt.color}18`,
                  color: opt.color,
                  borderColor: `${opt.color}30`,
                }}
              >
                {opt.label}
              </Badge>
            ) : (
              <span className="text-xs text-slate-300 cursor-pointer">--</span>
            )
          }
        />
      </td>

      {/* Companies — read-only */}
      <td className="px-3 py-2.5">
        {companiesText ? (
          <span className="text-xs text-slate-600 truncate block max-w-[200px]">
            {companiesText}
          </span>
        ) : (
          <span className="text-xs text-slate-300">--</span>
        )}
      </td>

      {/* Budget — inline text */}
      <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
        <InlineTextCell
          value={client.budget}
          onChange={(val) => updateClient(client.id, { budget: val })}
          placeholder="Бюджет..."
        />
      </td>

      {/* Operators/shift — inline text */}
      <td className="px-3 py-2.5 text-center" onClick={(e) => e.stopPropagation()}>
        <InlineTextCell
          value={client.operators_per_shift}
          onChange={(val) =>
            updateClient(client.id, { operators_per_shift: val })
          }
          placeholder="Оп/см..."
        />
      </td>

      {/* Contacts count */}
      <td className="px-3 py-2.5 text-center">
        <span
          className={cn(
            "text-xs tabular-nums",
            client.contacts.length > 0 ? "text-slate-600" : "text-slate-300"
          )}
        >
          {client.contacts.length}
        </span>
      </td>

      {/* Notes count */}
      <td className="px-3 py-2.5 text-center">
        <span
          className={cn(
            "text-xs tabular-nums",
            client.notes.length > 0 ? "text-slate-600" : "text-slate-300"
          )}
        >
          {client.notes.length}
        </span>
      </td>

      {/* Links count */}
      <td className="px-3 py-2.5 text-center">
        <span
          className={cn(
            "text-xs tabular-nums",
            client.links.length > 0 ? "text-slate-600" : "text-slate-300"
          )}
        >
          {client.links.length}
        </span>
      </td>

      {/* Created */}
      <td className="px-3 py-2.5">
        <span className="text-xs text-slate-500 whitespace-nowrap">
          {format(new Date(client.created_at), "d MMM yyyy", { locale: ru })}
        </span>
      </td>

      {/* Actions */}
      <td className="px-2 py-2.5 w-20">
        <div className="flex items-center justify-end">
          {confirmingDelete ? (
            <div
              className="flex items-center gap-1"
              onClick={(e) => e.stopPropagation()}
            >
              <span className="text-[10px] text-slate-500 mr-1">Удалить?</span>
              <button
                onClick={handleDelete}
                className="inline-flex items-center justify-center size-6 rounded bg-red-50 text-red-500 hover:bg-red-100 transition-colors text-xs font-medium"
              >
                Да
              </button>
              <button
                onClick={() => setConfirmingDelete(false)}
                className="inline-flex items-center justify-center size-6 rounded bg-slate-100 text-slate-500 hover:bg-slate-200 transition-colors text-xs font-medium"
              >
                Нет
              </button>
            </div>
          ) : (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setConfirmingDelete(true);
              }}
              className="inline-flex items-center justify-center size-6 rounded hover:bg-red-50 transition-colors text-slate-400 hover:text-red-500 opacity-0 group-hover:opacity-100"
            >
              <Trash2 className="size-3.5" />
            </button>
          )}
        </div>
      </td>
    </tr>
  );
}

/* -------------------------------------------------------------------------- */
/*  Main component                                                             */
/* -------------------------------------------------------------------------- */

export function ClientsView() {
  const clients = useFilteredClients();
  const allClients = useBrainStore((s) => s.clients);
  const clientSearch = useBrainStore((s) => s.clientSearch);
  const setClientSearch = useBrainStore((s) => s.setClientSearch);
  const openClientDetail = useBrainStore((s) => s.openClientDetail);
  const openCreateClient = useBrainStore((s) => s.openCreateClient);
  const deleteClient = useBrainStore((s) => s.deleteClient);
  const clientViewMode = useBrainStore((s) => s.clientViewMode);
  const setClientViewMode = useBrainStore((s) => s.setClientViewMode);
  const clientStatuses = useBrainStore((s) => s.clientStatuses);
  const clientStatusFilter = useBrainStore((s) => s.clientStatusFilter);
  const setClientStatusFilter = useBrainStore((s) => s.setClientStatusFilter);
  const detailMode = useBrainStore((s) => s.detailMode);
  const setDetailMode = useBrainStore((s) => s.setDetailMode);
  const clientGroupBy = useBrainStore((s) => s.clientGroupBy);
  const setClientGroupBy = useBrainStore((s) => s.setClientGroupBy);
  const reorderClients = useBrainStore((s) => s.reorderClients);
  const clientsCollapsedGroupsArr = useBrainStore((s) => s.clientsCollapsedGroups);
  const setClientsCollapsedGroups = useBrainStore((s) => s.setClientsCollapsedGroups);

  const collapsedGroups = useMemo(() => new Set(clientsCollapsedGroupsArr), [clientsCollapsedGroupsArr]);

  const [statusManagerOpen, setStatusManagerOpen] = useState(false);

  const handleDelete = useCallback(
    (id: string) => {
      deleteClient(id);
    },
    [deleteClient]
  );

  const toggleGroup = useCallback((key: string) => {
    setClientsCollapsedGroups(
      collapsedGroups.has(key)
        ? clientsCollapsedGroupsArr.filter((k) => k !== key)
        : [...clientsCollapsedGroupsArr, key]
    );
  }, [collapsedGroups, clientsCollapsedGroupsArr, setClientsCollapsedGroups]);

  /* ----- DnD sensors ------------------------------------------------------- */

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 3 },
    })
  );

  /* ----- Grouping ---------------------------------------------------------- */

  const isGrouped = clientGroupBy[0] !== "none";
  const hasLevel2 = clientGroupBy[1] !== "none";
  const dragDisabled = isGrouped;

  const groups = useMemo(
    () => groupClients(clients, clientGroupBy[0], clientStatuses),
    [clients, clientGroupBy, clientStatuses]
  );

  const clientIds = useMemo(() => clients.map((c) => c.id), [clients]);

  /* ----- Drag end handler -------------------------------------------------- */

  const handleDragEnd = useCallback(
    async (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;

      // Only allow reorder when no grouping is active
      if (isGrouped) return;

      const oldIndex = clients.findIndex((c) => c.id === active.id);
      const newIndex = clients.findIndex((c) => c.id === over.id);
      if (oldIndex === -1 || newIndex === -1) return;

      const reordered = arrayMove(clients, oldIndex, newIndex);
      const updates = reordered.map((client, index) => ({
        id: client.id,
        position: index,
      }));

      await reorderClients(updates);
    },
    [clients, isGrouped, reorderClients]
  );

  /* ----- Status filter label ----------------------------------------------- */

  const statusFilterLabel = useMemo(() => {
    if (!clientStatusFilter) return "Все статусы";
    const found = clientStatuses.find((s) => s.id === clientStatusFilter);
    return found?.name ?? "Все статусы";
  }, [clientStatusFilter, clientStatuses]);

  /* ----- Group by labels --------------------------------------------------- */

  const groupByLabel1 = useMemo(
    () =>
      CLIENT_GROUP_OPTIONS.find((o) => o.key === clientGroupBy[0])?.label ??
      "Без группировки",
    [clientGroupBy]
  );

  const groupByLabel2 = useMemo(
    () =>
      CLIENT_GROUP_OPTIONS.find((o) => o.key === clientGroupBy[1])?.label ??
      "Без группировки",
    [clientGroupBy]
  );

  const level2Options = useMemo(
    () =>
      CLIENT_GROUP_OPTIONS.filter(
        (o) => o.key === "none" || o.key !== clientGroupBy[0]
      ),
    [clientGroupBy]
  );

  /* ----- Column count for group colSpan ------------------------------------ */
  const colCount = 11; // drag + name + status + companies + budget + ops/shift + contacts + notes + links + created + actions

  /* ----- Render rows helper ------------------------------------------------ */

  function renderRows(rowClients: ClientFull[]) {
    return rowClients.map((client) => (
      <SortableClientRow
        key={client.id}
        client={client}
        onOpen={openClientDetail}
        onDelete={handleDelete}
        dragDisabled={dragDisabled}
        clientStatuses={clientStatuses}
      />
    ));
  }

  return (
    <TooltipProvider>
      <div className="flex flex-col h-full">
        {/* ---------------------------------------------------------------- */}
        {/*  Header bar                                                      */}
        {/* ---------------------------------------------------------------- */}
        <header className="flex h-12 shrink-0 items-center gap-2 border-b border-slate-200 bg-white px-4 sticky top-0 z-10">
          <h2 className="text-sm font-semibold text-slate-900 whitespace-nowrap mr-1">
            Клиенты
          </h2>

          {/* Search */}
          <div className="relative min-w-[160px] max-w-[240px] flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-slate-400" />
            <Input
              value={clientSearch}
              onChange={(e) => setClientSearch(e.target.value)}
              placeholder="Поиск..."
              className="pl-8 pr-8 h-8 rounded-md border-slate-200 bg-white text-sm text-slate-900 placeholder:text-slate-400 focus-visible:ring-slate-300"
            />
            {clientSearch && (
              <button
                type="button"
                onClick={() => setClientSearch("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded-sm text-slate-400 hover:text-slate-900 transition-colors"
              >
                <X className="size-3.5" />
              </button>
            )}
          </div>

          {/* Count */}
          <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-slate-500">
            {clients.length}
          </span>

          <Separator orientation="vertical" className="!h-5 bg-slate-200" />

          {/* Status filter dropdown */}
          <Select
            value={clientStatusFilter ?? "__all__"}
            onValueChange={(v) =>
              setClientStatusFilter(v === "__all__" ? null : v)
            }
          >
            <SelectTrigger
              size="sm"
              className="w-auto min-w-[120px] border-slate-200 bg-white text-xs h-7"
            >
              <SelectValue placeholder="Все статусы">
                {clientStatusFilter ? (
                  <span className="inline-flex items-center gap-1.5">
                    <span
                      className="inline-block size-2 rounded-full"
                      style={{
                        backgroundColor:
                          clientStatuses.find(
                            (s) => s.id === clientStatusFilter
                          )?.color ?? "#94a3b8",
                      }}
                    />
                    <span className="text-xs">{statusFilterLabel}</span>
                  </span>
                ) : (
                  <span className="text-xs text-slate-600">Все статусы</span>
                )}
              </SelectValue>
            </SelectTrigger>
            <SelectContent className="border-slate-200 bg-white">
              <SelectItem value="__all__">
                <span className="text-xs">Все статусы</span>
              </SelectItem>
              {clientStatuses.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  <span className="inline-flex items-center gap-1.5">
                    <span
                      className="inline-block size-2 rounded-full"
                      style={{ backgroundColor: s.color }}
                    />
                    <span className="text-xs">{s.name}</span>
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Separator orientation="vertical" className="!h-5 bg-slate-200" />

          {/* Grouping controls */}
          <span className="text-[11px] text-slate-400 whitespace-nowrap">
            Группировка:
          </span>
          <Select
            value={clientGroupBy[0]}
            onValueChange={(v) => {
              const field = v as ClientGroupByField;
              setClientGroupBy([field, clientGroupBy[1]]);
            }}
          >
            <SelectTrigger
              size="sm"
              className="w-auto min-w-[110px] border-slate-200 bg-white text-xs h-7"
            >
              <SelectValue>
                <span className="text-xs">{groupByLabel1}</span>
              </SelectValue>
            </SelectTrigger>
            <SelectContent className="border-slate-200 bg-white">
              {CLIENT_GROUP_OPTIONS.map((opt) => (
                <SelectItem key={opt.key} value={opt.key}>
                  <span className="text-xs">{opt.label}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {clientGroupBy[0] !== "none" && (
            <Select
              value={clientGroupBy[1]}
              onValueChange={(v) => {
                const field = v as ClientGroupByField;
                setClientGroupBy([clientGroupBy[0], field]);
              }}
            >
              <SelectTrigger
                size="sm"
                className="w-auto min-w-[110px] border-slate-200 bg-white text-xs h-7"
              >
                <SelectValue>
                  <span className="text-xs">{groupByLabel2}</span>
                </SelectValue>
              </SelectTrigger>
              <SelectContent className="border-slate-200 bg-white">
                {level2Options.map((opt) => (
                  <SelectItem key={opt.key} value={opt.key}>
                    <span className="text-xs">{opt.label}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          <div className="flex-1" />

          <Separator orientation="vertical" className="!h-5 bg-slate-200" />

          {/* View mode toggle */}
          <div className="flex items-center rounded-lg border border-slate-200 bg-slate-50 p-0.5">
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    className={cn(
                      "rounded-md text-slate-400 hover:text-slate-600",
                      clientViewMode === "kanban" &&
                        "bg-white text-slate-900 shadow-sm"
                    )}
                    onClick={() => setClientViewMode("kanban")}
                  />
                }
              >
                <LayoutGrid className="size-3.5" />
              </TooltipTrigger>
              <TooltipContent side="bottom">Канбан</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    className={cn(
                      "rounded-md text-slate-400 hover:text-slate-600",
                      clientViewMode === "list" &&
                        "bg-white text-slate-900 shadow-sm"
                    )}
                    onClick={() => setClientViewMode("list")}
                  />
                }
              >
                <List className="size-3.5" />
              </TooltipTrigger>
              <TooltipContent side="bottom">Список</TooltipContent>
            </Tooltip>
          </div>

          {/* Detail mode toggle */}
          <div className="flex items-center rounded-lg border border-slate-200 bg-slate-50 p-0.5">
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    className={cn(
                      "rounded-md text-slate-400 hover:text-slate-600",
                      detailMode === "modal" &&
                        "bg-white text-slate-900 shadow-sm"
                    )}
                    onClick={() => setDetailMode("modal")}
                  />
                }
              >
                <Maximize2 className="size-3.5" />
              </TooltipTrigger>
              <TooltipContent side="bottom">Модальное окно</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    className={cn(
                      "rounded-md text-slate-400 hover:text-slate-600",
                      detailMode === "panel" &&
                        "bg-white text-slate-900 shadow-sm"
                    )}
                    onClick={() => setDetailMode("panel")}
                  />
                }
              >
                <PanelRight className="size-3.5" />
              </TooltipTrigger>
              <TooltipContent side="bottom">Боковая панель</TooltipContent>
            </Tooltip>
          </div>

          <Separator orientation="vertical" className="!h-5 bg-slate-200" />

          {/* Status manager */}
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-xs"
                  onClick={() => setStatusManagerOpen(true)}
                  className="text-slate-400 hover:text-slate-600"
                />
              }
            >
              <Settings className="size-3.5" />
            </TooltipTrigger>
            <TooltipContent side="bottom">Статусы</TooltipContent>
          </Tooltip>

          {/* Create */}
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  size="icon-sm"
                  className="bg-gradient-to-r from-violet-600 to-indigo-600 text-white shadow-lg shadow-violet-500/20 transition-all hover:from-violet-500 hover:to-indigo-500"
                  onClick={openCreateClient}
                />
              }
            >
              <Plus className="size-4" />
            </TooltipTrigger>
            <TooltipContent side="bottom">Новый клиент</TooltipContent>
          </Tooltip>
        </header>

        {/* ---------------------------------------------------------------- */}
        {/*  Content                                                          */}
        {/* ---------------------------------------------------------------- */}
        {allClients.length === 0 ? (
          <EmptyState onCreateClient={openCreateClient} />
        ) : clientViewMode === "kanban" ? (
          <ClientsKanban
            clients={clients}
            onOpen={openClientDetail}
            onDelete={handleDelete}
          />
        ) : (
          <ScrollArea className="flex-1">
            {clients.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 px-6">
                <p className="text-sm text-slate-400">
                  Нет клиентов по заданным фильтрам
                </p>
              </div>
            ) : (
              <div className="min-w-[1000px]">
                <DndContext
                  sensors={sensors}
                  collisionDetection={closestCenter}
                  onDragEnd={handleDragEnd}
                >
                  <SortableContext
                    items={clientIds}
                    strategy={verticalListSortingStrategy}
                  >
                    <table className="w-full border-collapse bg-white">
                      <thead className="sticky top-0 z-[5]">
                        <tr className="bg-slate-50 border-b border-slate-200">
                          <th className="w-8 px-1 py-2" />
                          <th className="px-4 py-2 text-left text-[10px] font-medium uppercase tracking-wider text-slate-500">
                            Имя
                          </th>
                          <th className="px-3 py-2 text-left text-[10px] font-medium uppercase tracking-wider text-slate-500 w-28">
                            Статус
                          </th>
                          <th className="px-3 py-2 text-left text-[10px] font-medium uppercase tracking-wider text-slate-500 w-44">
                            Компании
                          </th>
                          <th className="px-3 py-2 text-left text-[10px] font-medium uppercase tracking-wider text-slate-500 w-28">
                            <span className="inline-flex items-center gap-1">
                              <Banknote className="size-3 text-slate-400" />
                              Бюджет
                            </span>
                          </th>
                          <th className="px-3 py-2 text-center text-[10px] font-medium uppercase tracking-wider text-slate-500 w-24">
                            <span className="inline-flex items-center gap-1 justify-center">
                              <UserCheck className="size-3 text-slate-400" />
                              Оп/см
                            </span>
                          </th>
                          <th className="px-3 py-2 text-center text-[10px] font-medium uppercase tracking-wider text-slate-500 w-16">
                            <Phone className="size-3 mx-auto text-slate-400" />
                          </th>
                          <th className="px-3 py-2 text-center text-[10px] font-medium uppercase tracking-wider text-slate-500 w-16">
                            <StickyNote className="size-3 mx-auto text-slate-400" />
                          </th>
                          <th className="px-3 py-2 text-center text-[10px] font-medium uppercase tracking-wider text-slate-500 w-16">
                            <Link2 className="size-3 mx-auto text-slate-400" />
                          </th>
                          <th className="px-3 py-2 text-left text-[10px] font-medium uppercase tracking-wider text-slate-500 w-28">
                            Создан
                          </th>
                          <th className="w-20" />
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {isGrouped && groups.length > 0
                          ? groups.map((group) => {
                              const l1Key = group.key;
                              const groupCollapsed =
                                collapsedGroups.has(l1Key);

                              const level2Groups = hasLevel2
                                ? groupClients(
                                    group.items,
                                    clientGroupBy[1],
                                    clientStatuses
                                  )
                                : null;

                              return (
                                <GroupSection
                                  key={l1Key}
                                  group={group}
                                  collapsed={groupCollapsed}
                                  onToggle={() => toggleGroup(l1Key)}
                                  colCount={colCount}
                                  depth={0}
                                >
                                  {!groupCollapsed &&
                                    (level2Groups
                                      ? level2Groups.map((subGroup) => {
                                          const l2Key = `${l1Key}::${subGroup.key}`;
                                          const l2Collapsed =
                                            collapsedGroups.has(l2Key);

                                          return (
                                            <GroupSection
                                              key={l2Key}
                                              group={subGroup}
                                              collapsed={l2Collapsed}
                                              onToggle={() =>
                                                toggleGroup(l2Key)
                                              }
                                              colCount={colCount}
                                              depth={1}
                                            >
                                              {!l2Collapsed &&
                                                renderRows(subGroup.items)}
                                            </GroupSection>
                                          );
                                        })
                                      : renderRows(group.items))}
                                </GroupSection>
                              );
                            })
                          : renderRows(clients)}
                      </tbody>
                    </table>
                  </SortableContext>
                </DndContext>
              </div>
            )}
          </ScrollArea>
        )}

        <StatusManager
          open={statusManagerOpen}
          onOpenChange={setStatusManagerOpen}
        />
      </div>
    </TooltipProvider>
  );
}
