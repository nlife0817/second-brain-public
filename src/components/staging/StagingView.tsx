"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useBrainStore, useCategoryConfig } from "@/lib/store";
import {
  CheckCircle2, XCircle, Pencil, Trash2, ChevronDown, ChevronRight, X,
  ClipboardCheck, CheckSquare, StickyNote, Calendar, Map, Lightbulb, Users,
  Link as LinkIcon,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
} from "@/components/ui/tooltip";
import type { StagingItemParsed, StagingParsedData, ItemType, ItemPriority, ItemCategory, ItemStatus, StagingEntityType } from "@/types";
import { TYPE_CONFIG, PRIORITY_CONFIG, STATUS_CONFIG } from "@/types";

const ENTITY_TYPE_CONFIG: Record<StagingEntityType, { label: string; icon: LucideIcon; color: string }> = {
  item: { label: "Элемент", icon: CheckSquare, color: "text-violet-500" },
  client: { label: "Клиент", icon: Users, color: "text-blue-500" },
};

const TYPE_ICONS: Record<string, LucideIcon> = {
  task: CheckSquare,
  note: StickyNote,
  meeting: Calendar,
  plan: Map,
  idea: Lightbulb,
};

export function StagingView() {
  const stagingItems = useBrainStore((s) => s.stagingItems);
  const approveStagingItem = useBrainStore((s) => s.approveStagingItem);
  const rejectStagingItem = useBrainStore((s) => s.rejectStagingItem);
  const updateStagingItem = useBrainStore((s) => s.updateStagingItem);
  const deleteStagingItem = useBrainStore((s) => s.deleteStagingItem);
  const fetchStagingItems = useBrainStore((s) => s.fetchStagingItems);
  const storeCategories = useBrainStore((s) => s.categories);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [collapsedBatches, setCollapsedBatches] = useState<Set<string>>(new Set());
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkLoading, setBulkLoading] = useState(false);

  const grouped = useMemo(() => {
    const map: Record<string, StagingItemParsed[]> = {};
    for (const item of stagingItems) {
      const key = item.batch_id || "no-batch";
      if (!map[key]) map[key] = [];
      map[key].push(item);
    }
    return Object.entries(map).sort(([, a], [, b]) => {
      const da = new Date(a[0]?.created_at || 0).getTime();
      const db = new Date(b[0]?.created_at || 0).getTime();
      return db - da;
    });
  }, [stagingItems]);

  useEffect(() => {
    setSelectedIds((current) => {
      const next = new Set(Array.from(current).filter((id) => stagingItems.some((item) => item.id === id)));
      return next.size === current.size ? current : next;
    });
  }, [stagingItems]);

  const toggleBatch = useCallback((batchId: string) => {
    setCollapsedBatches((prev) => {
      const next = new Set(prev);
      if (next.has(batchId)) next.delete(batchId);
      else next.add(batchId);
      return next;
    });
  }, []);

  const handleApproveAll = useCallback(async (items: StagingItemParsed[]) => {
    for (const item of items) {
      await approveStagingItem(item.id);
    }
  }, [approveStagingItem]);

  const handleRejectAll = useCallback(async (items: StagingItemParsed[]) => {
    for (const item of items) {
      await rejectStagingItem(item.id);
    }
  }, [rejectStagingItem]);

  const toggleSelected = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  const handleBulkUpdate = useCallback(async (
    field: "entity_type" | "type" | "status" | "priority" | "category",
    value: string | null
  ) => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;

    setBulkLoading(true);
    try {
      await Promise.all(ids.map(async (id) => {
        const item = stagingItems.find((entry) => entry.id === id);
        if (!item) return;

        if (field === "entity_type") {
          await updateStagingItem(id, { entity_type: value as StagingEntityType });
          return;
        }

        if (item.entity_type !== "item") return;

        await updateStagingItem(id, {
          parsed_data: {
            ...item.parsed_data,
            [field]: value,
          },
        });
      }));
    } finally {
      setBulkLoading(false);
    }
  }, [selectedIds, stagingItems, updateStagingItem]);

  const handleBulkApprove = useCallback(async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    setBulkLoading(true);
    try {
      await Promise.all(ids.map((id) => approveStagingItem(id)));
      setSelectedIds(new Set());
    } finally {
      setBulkLoading(false);
    }
  }, [approveStagingItem, selectedIds]);

  const handleBulkReject = useCallback(async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    setBulkLoading(true);
    try {
      await Promise.all(ids.map((id) => rejectStagingItem(id)));
      setSelectedIds(new Set());
    } finally {
      setBulkLoading(false);
    }
  }, [rejectStagingItem, selectedIds]);

  const handleBulkDelete = useCallback(async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    setBulkLoading(true);
    try {
      await Promise.all(ids.map((id) => deleteStagingItem(id)));
      setSelectedIds(new Set());
    } finally {
      setBulkLoading(false);
    }
  }, [deleteStagingItem, selectedIds]);

  if (stagingItems.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-4 text-center p-8">
        <ClipboardCheck className="size-12 text-slate-300" />
        <div>
          <h2 className="text-lg font-semibold text-slate-700 mb-1">Нет элементов на согласование</h2>
          <p className="text-sm text-slate-400 max-w-md">
            Используйте команду <code className="bg-slate-100 px-1.5 py-0.5 rounded text-xs font-mono">/add</code> в VS Code чтобы добавить новые записи.
            Они появятся здесь для проверки и одобрения.
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={() => fetchStagingItems()}>
          Обновить
        </Button>
      </div>
    );
  }

  return (
    <TooltipProvider>
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center gap-3 px-6 py-3 border-b border-slate-200 bg-white/50">
          <ClipboardCheck className="size-4 text-violet-500" />
          <h1 className="text-sm font-semibold text-slate-900">Согласование</h1>
          <Badge variant="outline" className="border-violet-200 bg-violet-50 text-violet-600 text-[10px]">
            {stagingItems.length}
          </Badge>
          <div className="flex-1" />
          <Button variant="ghost" size="sm" className="text-slate-500 text-xs" onClick={() => fetchStagingItems()}>
            Обновить
          </Button>
        </div>

        {selectedIds.size > 0 && (
          <div className="border-b border-blue-200 bg-blue-50/80 px-6 py-2.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-medium text-blue-700">
                Выбрано: {selectedIds.size}
              </span>
              <Button
                variant="ghost"
                size="icon-xs"
                className="text-blue-500 hover:text-blue-700 hover:bg-blue-100"
                onClick={clearSelection}
                disabled={bulkLoading}
              >
                <X className="size-3.5" />
              </Button>
              <div className="h-4 w-px bg-blue-200" />
              <BulkActionSelect
                label="Сущность"
                options={[
                  { value: "item", label: "Элемент" },
                  { value: "client", label: "Клиент" },
                ]}
                onSelect={(value) => handleBulkUpdate("entity_type", value)}
                disabled={bulkLoading}
              />
              <BulkActionSelect
                label="Тип"
                options={Object.entries(TYPE_CONFIG).map(([value, config]) => ({ value, label: config.label }))}
                onSelect={(value) => handleBulkUpdate("type", value)}
                disabled={bulkLoading}
              />
              <BulkActionSelect
                label="Статус"
                options={Object.entries(STATUS_CONFIG).map(([value, config]) => ({ value, label: config.label }))}
                onSelect={(value) => handleBulkUpdate("status", value)}
                disabled={bulkLoading}
              />
              <BulkActionSelect
                label="Приоритет"
                options={Object.entries(PRIORITY_CONFIG).map(([value, config]) => ({ value, label: config.label }))}
                onSelect={(value) => handleBulkUpdate("priority", value)}
                disabled={bulkLoading}
              />
              <BulkActionSelect
                label="Категория"
                options={storeCategories.map((c) => ({ value: c.id, label: c.name }))}
                onSelect={(value) => handleBulkUpdate("category", value)}
                disabled={bulkLoading}
              />
              <div className="h-4 w-px bg-blue-200" />
              <Button variant="outline" size="sm" onClick={handleBulkApprove} disabled={bulkLoading}>
                <CheckCircle2 className="size-4" />
                Одобрить
              </Button>
              <Button variant="outline" size="sm" onClick={handleBulkReject} disabled={bulkLoading}>
                <XCircle className="size-4" />
                Отклонить
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="text-red-600 hover:bg-red-100 hover:text-red-700"
                onClick={handleBulkDelete}
                disabled={bulkLoading}
              >
                <Trash2 className="size-4" />
                Удалить
              </Button>
            </div>
          </div>
        )}

        {/* Content */}
        <ScrollArea className="flex-1">
          <div className="p-4 space-y-4">
            {grouped.map(([batchId, items]) => {
              const isCollapsed = collapsedBatches.has(batchId);
              const batchDate = items[0]?.created_at
                ? new Date(items[0].created_at).toLocaleString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
                : "";

              const typeGroups = groupByType(items);

              return (
                <div key={batchId} className="border border-slate-200 rounded-xl bg-white overflow-hidden">
                  {/* Batch header */}
                  <div
                    className="flex items-center gap-2 px-4 py-2.5 bg-slate-50/80 cursor-pointer hover:bg-slate-100/80 transition-colors"
                    onClick={() => toggleBatch(batchId)}
                  >
                    {isCollapsed ? (
                      <ChevronRight className="size-3.5 text-slate-400" />
                    ) : (
                      <ChevronDown className="size-3.5 text-slate-400" />
                    )}
                    <span className="text-xs font-medium text-slate-500">
                      Пакет от {batchDate}
                    </span>
                    <Badge variant="outline" className="text-[10px] border-slate-200 text-slate-400">
                      {items.length} {getItemWord(items.length)}
                    </Badge>
                    <div className="flex-1" />
                    <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                      <Tooltip>
                        <TooltipTrigger
                          render={
                            <Button
                              variant="ghost"
                              size="icon-xs"
                              className="text-emerald-500 hover:text-emerald-600 hover:bg-emerald-50"
                              onClick={() => handleApproveAll(items)}
                            />
                          }
                        >
                          <CheckCircle2 className="size-3.5" />
                        </TooltipTrigger>
                        <TooltipContent>Одобрить все</TooltipContent>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger
                          render={
                            <Button
                              variant="ghost"
                              size="icon-xs"
                              className="text-red-400 hover:text-red-500 hover:bg-red-50"
                              onClick={() => handleRejectAll(items)}
                            />
                          }
                        >
                          <XCircle className="size-3.5" />
                        </TooltipTrigger>
                        <TooltipContent>Отклонить все</TooltipContent>
                      </Tooltip>
                    </div>
                  </div>

                  {/* Items */}
                  {!isCollapsed && (
                    <div className="divide-y divide-slate-100">
                      {typeGroups.map(([groupLabel, groupIcon, groupItems]) => (
                        <div key={groupLabel}>
                          {typeGroups.length > 1 && (
                            <div className="flex items-center gap-2 px-4 py-1.5 bg-slate-50/40">
                              {groupIcon}
                              <span className="text-[11px] font-medium uppercase tracking-wider text-slate-400">
                                {groupLabel}
                              </span>
                              <span className="text-[10px] text-slate-300">{groupItems.length}</span>
                            </div>
                          )}
                          {groupItems.map((item) => (
                            <StagingCard
                              key={item.id}
                              item={item}
                              selected={selectedIds.has(item.id)}
                              onToggleSelected={() => toggleSelected(item.id)}
                              isEditing={editingId === item.id}
                              onEdit={() => setEditingId(editingId === item.id ? null : item.id)}
                              onApprove={() => approveStagingItem(item.id)}
                              onReject={() => rejectStagingItem(item.id)}
                              onDelete={() => deleteStagingItem(item.id)}
                              onUpdate={(updates) => updateStagingItem(item.id, updates)}
                            />
                          ))}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </ScrollArea>
      </div>
    </TooltipProvider>
  );
}

function groupByType(items: StagingItemParsed[]): [string, React.ReactNode, StagingItemParsed[]][] {
  const groups: Record<string, StagingItemParsed[]> = {};
  for (const item of items) {
    let key: string;
    if (item.entity_type === "client") {
      key = "client";
    } else {
      key = item.parsed_data.type || "__untyped__";
    }
    if (!groups[key]) groups[key] = [];
    groups[key].push(item);
  }

  const order = ["__untyped__", "task", "note", "meeting", "plan", "idea", "client"];
  return order
    .filter((k) => groups[k]?.length)
    .map((k) => {
      if (k === "__untyped__") {
        return ["Без типа", <CheckSquare key="untyped" className="size-3 text-slate-300" />, groups[k]!] as [string, React.ReactNode, StagingItemParsed[]];
      }
      if (k === "client") {
        const cfg = ENTITY_TYPE_CONFIG.client;
        return [cfg.label + "ы", <Users key="c" className={cn("size-3", cfg.color)} />, groups[k]!] as [string, React.ReactNode, StagingItemParsed[]];
      }
      const cfg = TYPE_CONFIG[k as ItemType];
      const Icon = TYPE_ICONS[k] || CheckSquare;
      return [cfg.label + "и", <Icon key={k} className="size-3 text-slate-400" />, groups[k]!] as [string, React.ReactNode, StagingItemParsed[]];
    });
}

function StagingCard({
  item,
  selected,
  onToggleSelected,
  isEditing,
  onEdit,
  onApprove,
  onReject,
  onDelete,
  onUpdate,
}: {
  item: StagingItemParsed;
  selected: boolean;
  onToggleSelected: () => void;
  isEditing: boolean;
  onEdit: () => void;
  onApprove: () => void;
  onReject: () => void;
  onDelete: () => void;
  onUpdate: (updates: Partial<Pick<StagingItemParsed, "title" | "description" | "entity_type"> & { parsed_data: StagingParsedData }>) => void;
}) {
  const catCfg = useCategoryConfig();
  const pd = item.parsed_data;
  const isItem = item.entity_type === "item";
  const typeLabel = isItem ? (TYPE_CONFIG[pd.type || "task"]?.label || "Задача") : "Клиент";
  const TypeIcon = isItem ? (TYPE_ICONS[pd.type || "task"] || CheckSquare) : Users;
  const priorityLabel = pd.priority ? PRIORITY_CONFIG[pd.priority]?.label : null;
  const priorityIcon = pd.priority ? PRIORITY_CONFIG[pd.priority]?.icon : null;
  const categoryLabel = pd.category ? catCfg[pd.category]?.label ?? pd.category : null;
  const statusLabel = pd.status ? STATUS_CONFIG[pd.status]?.label : null;
  const statusColor = pd.status ? STATUS_CONFIG[pd.status]?.color : "";

  return (
    <div className={cn("group/card px-4 py-3 transition-colors", selected ? "bg-blue-50/70" : "hover:bg-slate-50/50")}>
      <div className="flex items-start gap-3">
        <div className="pt-1" onClick={(e) => e.stopPropagation()}>
          <Checkbox checked={selected} onCheckedChange={onToggleSelected} />
        </div>

        {/* Type icon */}
        <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md bg-slate-100 text-slate-400">
          <TypeIcon className="size-3.5" />
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          {isEditing ? (
            <StagingEditForm item={item} onUpdate={onUpdate} onClose={onEdit} />
          ) : (
            <>
              <div className="flex items-center gap-2 mb-0.5">
                <span className="text-sm font-medium text-slate-900 truncate">{item.title}</span>
              </div>

              {item.description && (
                <div
                  className="mb-1.5 max-h-40 overflow-hidden text-xs text-slate-500 prose prose-sm max-w-none [&_img]:my-2 [&_img]:max-h-28 [&_img]:rounded-md [&_img]:border [&_img]:border-slate-200"
                  dangerouslySetInnerHTML={{ __html: item.description }}
                />
              )}

              {/* Meta badges */}
              <div className="flex flex-wrap items-center gap-1.5">
                <Badge variant="outline" className="text-[10px] border-slate-200 text-slate-500">
                  {typeLabel}
                </Badge>

                {statusLabel && (
                  <Badge variant="outline" className={cn("text-[10px]", statusColor)}>
                    {statusLabel}
                  </Badge>
                )}

                {priorityLabel && priorityLabel !== "Без приоритета" && (
                  <Badge variant="outline" className="text-[10px] border-slate-200">
                    {priorityIcon} {priorityLabel}
                  </Badge>
                )}

                {categoryLabel && (
                  <Badge variant="outline" className="text-[10px] border-slate-200 text-slate-400">
                    {categoryLabel}
                  </Badge>
                )}

                {pd.due_date && (
                  <Badge variant="outline" className="text-[10px] border-slate-200 text-slate-400">
                    {new Date(pd.due_date).toLocaleDateString("ru-RU", { day: "numeric", month: "short" })}
                  </Badge>
                )}

                {pd.subtasks && pd.subtasks.length > 0 && (
                  <Badge variant="outline" className="text-[10px] border-violet-200 text-violet-500">
                    {pd.subtasks.length} подзадач
                  </Badge>
                )}

                {pd.relations && pd.relations.length > 0 && (
                  <Badge variant="outline" className="text-[10px] border-blue-200 text-blue-500">
                    <LinkIcon className="size-2.5 mr-0.5" />
                    {pd.relations.length} связей
                  </Badge>
                )}
              </div>

              {/* Subtasks preview */}
              {pd.subtasks && pd.subtasks.length > 0 && (
                <div className="mt-2 pl-2 border-l-2 border-slate-200 space-y-0.5">
                  {pd.subtasks.map((sub, i) => (
                    <div key={i} className="text-xs text-slate-500 flex items-center gap-1.5">
                      <CheckSquare className="size-2.5 text-slate-300" />
                      {sub.title}
                    </div>
                  ))}
                </div>
              )}

              {/* Relations preview */}
              {pd.relations && pd.relations.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {pd.relations.map((rel, i) => (
                    <Badge key={i} variant="outline" className="text-[10px] border-blue-100 bg-blue-50/50 text-blue-600">
                      <LinkIcon className="size-2 mr-0.5" />
                      {rel.target_title}
                    </Badge>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover/card:opacity-100 transition-opacity">
          <Tooltip>
            <TooltipTrigger
              render={
                <Button variant="ghost" size="icon-xs" className="text-slate-400 hover:text-slate-600" onClick={onEdit} />
              }
            >
              <Pencil className="size-3" />
            </TooltipTrigger>
            <TooltipContent>Редактировать</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button variant="ghost" size="icon-xs" className="text-emerald-500 hover:text-emerald-600 hover:bg-emerald-50" onClick={onApprove} />
              }
            >
              <CheckCircle2 className="size-3.5" />
            </TooltipTrigger>
            <TooltipContent>Одобрить</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button variant="ghost" size="icon-xs" className="text-red-400 hover:text-red-500 hover:bg-red-50" onClick={onReject} />
              }
            >
              <XCircle className="size-3.5" />
            </TooltipTrigger>
            <TooltipContent>Отклонить</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button variant="ghost" size="icon-xs" className="text-slate-300 hover:text-red-400 hover:bg-red-50" onClick={onDelete} />
              }
            >
              <Trash2 className="size-3" />
            </TooltipTrigger>
            <TooltipContent>Удалить</TooltipContent>
          </Tooltip>
        </div>
      </div>
    </div>
  );
}

function StagingEditForm({
  item,
  onUpdate,
  onClose,
}: {
  item: StagingItemParsed;
  onUpdate: (updates: Partial<Pick<StagingItemParsed, "title" | "description" | "entity_type"> & { parsed_data: StagingParsedData }>) => void;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(item.title);
  const [description, setDescription] = useState(item.description);
  const [entityType, setEntityType] = useState<StagingEntityType>(item.entity_type as StagingEntityType);
  const [type, setType] = useState<string>(item.parsed_data.type ?? "__none__");
  const [status, setStatus] = useState<string>(item.parsed_data.status ?? "__none__");
  const [priority, setPriority] = useState<string>(item.parsed_data.priority ?? "__none__");
  const [category, setCategory] = useState<string>(item.parsed_data.category ?? "__none__");
  const editCategories = useBrainStore((s) => s.categories);

  const handleSave = () => {
    const parsed_data: StagingParsedData = {
      ...item.parsed_data,
      type: type === "__none__" ? null : (type as ItemType),
      status: status === "__none__" ? null : (status as ItemStatus),
      priority: priority === "__none__" ? null : (priority as ItemPriority),
      category: category === "__none__" ? null : (category as ItemCategory),
    };
    onUpdate({ title, description, entity_type: entityType, parsed_data });
    onClose();
  };

  return (
    <div className="space-y-3">
      <Input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        className="text-sm font-medium h-8"
        placeholder="Заголовок"
      />
      <Textarea
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        className="text-xs min-h-[60px] resize-none"
        placeholder="Описание"
      />

      <div className="grid grid-cols-2 gap-2">
        <Select value={entityType} onValueChange={(v) => setEntityType(v as StagingEntityType)}>
          <SelectTrigger className="h-7 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="item">Элемент</SelectItem>
            <SelectItem value="client">Клиент</SelectItem>
          </SelectContent>
        </Select>

        {entityType === "item" && (
          <Select value={type} onValueChange={(v) => setType(v ?? "__none__")}>
            <SelectTrigger className="h-7 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">Не выбрано</SelectItem>
              {Object.entries(TYPE_CONFIG).map(([k, v]) => (
                <SelectItem key={k} value={k}>{v.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {entityType === "item" && (
          <Select value={priority} onValueChange={(v) => setPriority(v ?? "__none__")}>
            <SelectTrigger className="h-7 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">Не выбрано</SelectItem>
              {Object.entries(PRIORITY_CONFIG).map(([k, v]) => (
                <SelectItem key={k} value={k}>{v.icon} {v.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {entityType === "item" && (
          <Select value={category} onValueChange={(v) => setCategory(v ?? "__none__")}>
            <SelectTrigger className="h-7 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">Не выбрано</SelectItem>
              {editCategories.map((cat) => (
                <SelectItem key={cat.id} value={cat.id}>{cat.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {entityType === "item" && (
          <Select value={status} onValueChange={(v) => setStatus(v ?? "__none__")}>
            <SelectTrigger className="h-7 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">Не выбрано</SelectItem>
              {Object.entries(STATUS_CONFIG).map(([k, v]) => (
                <SelectItem key={k} value={k}>{v.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      <div className="flex items-center gap-2 pt-1">
        <Button size="sm" className="h-7 text-xs bg-gradient-to-r from-violet-500 to-indigo-600 text-white" onClick={handleSave}>
          Сохранить
        </Button>
        <Button variant="ghost" size="sm" className="h-7 text-xs text-slate-500" onClick={onClose}>
          Отмена
        </Button>
      </div>
    </div>
  );
}

function BulkActionSelect({
  label,
  options,
  onSelect,
  disabled = false,
}: {
  label: string;
  options: Array<{ value: string; label: string }>;
  onSelect: (value: string) => void;
  disabled?: boolean;
}) {
  const [value, setValue] = useState("__placeholder__");

  return (
    <Select
      value={value}
      onValueChange={(next) => {
        if (!next || next === "__placeholder__") return;
        onSelect(next);
        setValue("__placeholder__");
      }}
      disabled={disabled}
    >
      <SelectTrigger className="h-7 min-w-[140px] bg-white text-xs">
        <SelectValue placeholder={label} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="__placeholder__">{label}</SelectItem>
        {options.map((option) => (
          <SelectItem key={`${label}-${option.value}`} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function getItemWord(count: number): string {
  const mod100 = count % 100;
  const mod10 = count % 10;
  if (mod100 >= 11 && mod100 <= 19) return "элементов";
  if (mod10 === 1) return "элемент";
  if (mod10 >= 2 && mod10 <= 4) return "элемента";
  return "элементов";
}
