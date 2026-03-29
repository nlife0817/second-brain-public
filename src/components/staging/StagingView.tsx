"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useBrainStore } from "@/lib/store";
import {
  KaitenDevelopmentStageSelect,
  KaitenParticipantsSelect,
  useKaitenCatalog,
} from "@/components/kaiten/KaitenValueControls";
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ClipboardCheck,
  Settings2,
  Trash2,
  X,
  XCircle,
} from "lucide-react";
import type {
  ItemCategory,
  ItemPriority,
  ItemStatus,
  ItemType,
  StagingEntityType,
  StagingItemParsed,
  StagingParsedData,
} from "@/types";
import { PRIORITY_CONFIG, STATUS_CONFIG, TYPE_CONFIG } from "@/types";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

type BulkField = "entity_type" | "type" | "status" | "priority" | "category";
type StagingColumnId =
  | "entity_type"
  | "type"
  | "status"
  | "priority"
  | "category"
  | "due_date"
  | "development_stage"
  | "participants";

const STAGING_COLUMNS: Array<{
  id: StagingColumnId;
  label: string;
  widthClass: string;
}> = [
  { id: "entity_type", label: "Сущность", widthClass: "w-28" },
  { id: "type", label: "Тип", widthClass: "w-28" },
  { id: "status", label: "Статус", widthClass: "w-32" },
  { id: "priority", label: "Приоритет", widthClass: "w-32" },
  { id: "category", label: "Категория", widthClass: "w-36" },
  { id: "due_date", label: "Срок", widthClass: "w-32" },
  { id: "development_stage", label: "Этап разработки", widthClass: "w-44" },
  { id: "participants", label: "Участники", widthClass: "w-52" },
];

const DEFAULT_STAGING_COLUMNS: StagingColumnId[] = [
  "entity_type",
  "type",
  "status",
  "priority",
  "category",
  "due_date",
  "development_stage",
  "participants",
];

const ENTITY_TYPE_OPTIONS: Array<{
  value: StagingEntityType;
  label: string;
}> = [
  { value: "item", label: "Элемент" },
  { value: "client", label: "Клиент" },
];

export function StagingView() {
  const stagingItems = useBrainStore((s) => s.stagingItems);
  const approveStagingItem = useBrainStore((s) => s.approveStagingItem);
  const rejectStagingItem = useBrainStore((s) => s.rejectStagingItem);
  const updateStagingItem = useBrainStore((s) => s.updateStagingItem);
  const deleteStagingItem = useBrainStore((s) => s.deleteStagingItem);
  const fetchStagingItems = useBrainStore((s) => s.fetchStagingItems);
  const categories = useBrainStore((s) => s.categories);
  const { catalog } = useKaitenCatalog();

  const [collapsedBatches, setCollapsedBatches] = useState<Set<string>>(
    new Set()
  );
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [bulkLoading, setBulkLoading] = useState(false);
  const [visibleColumns, setVisibleColumns] = useState<StagingColumnId[]>(() => {
    if (typeof window === "undefined") return DEFAULT_STAGING_COLUMNS;
    const raw = window.localStorage.getItem("second-brain-staging-columns");
    if (!raw) return DEFAULT_STAGING_COLUMNS;

    try {
      const parsed = JSON.parse(raw) as string[];
      const next = DEFAULT_STAGING_COLUMNS.filter((id) => parsed.includes(id));
      return next.length > 0 ? next : DEFAULT_STAGING_COLUMNS;
    } catch {
      return DEFAULT_STAGING_COLUMNS;
    }
  });

  const localizedCategories = useMemo(
    () =>
      categories.map((category) => ({
        value: category.id,
        label: localizeCategoryLabel(category.name, category.id),
      })),
    [categories]
  );

  const visibleColumnDefs = useMemo(() => {
    const visible = new Set(visibleColumns);
    return STAGING_COLUMNS.filter((column) => visible.has(column.id));
  }, [visibleColumns]);

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
      const next = new Set(
        Array.from(current).filter((id) =>
          stagingItems.some((item) => item.id === id)
        )
      );
      return next.size === current.size ? current : next;
    });

    setExpandedIds((current) => {
      const next = new Set(
        Array.from(current).filter((id) =>
          stagingItems.some((item) => item.id === id)
        )
      );
      return next.size === current.size ? current : next;
    });
  }, [stagingItems]);

  useEffect(() => {
    window.localStorage.setItem(
      "second-brain-staging-columns",
      JSON.stringify(visibleColumns)
    );
  }, [visibleColumns]);

  const toggleBatch = useCallback((batchId: string) => {
    setCollapsedBatches((prev) => {
      const next = new Set(prev);
      if (next.has(batchId)) next.delete(batchId);
      else next.add(batchId);
      return next;
    });
  }, []);

  const toggleSelected = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleBatchSelection = useCallback((items: StagingItemParsed[]) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      const allSelected =
        items.length > 0 && items.every((item) => next.has(item.id));

      for (const item of items) {
        if (allSelected) next.delete(item.id);
        else next.add(item.id);
      }

      return next;
    });
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  const toggleExpanded = useCallback((id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleBulkUpdate = useCallback(
    async (field: BulkField, value: string) => {
      const ids = Array.from(selectedIds);
      if (ids.length === 0) return;

      setBulkLoading(true);
      try {
        await Promise.all(
          ids.map(async (id) => {
            const item = stagingItems.find((entry) => entry.id === id);
            if (!item) return;

            if (field === "entity_type") {
              await updateStagingItem(id, {
                entity_type: value as StagingEntityType,
              });
              return;
            }

            if (item.entity_type !== "item") return;

            await updateStagingItem(id, {
              parsed_data: {
                ...item.parsed_data,
                [field]: value,
              },
            });
          })
        );
      } finally {
        setBulkLoading(false);
      }
    },
    [selectedIds, stagingItems, updateStagingItem]
  );

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
      setExpandedIds(new Set());
    } finally {
      setBulkLoading(false);
    }
  }, [deleteStagingItem, selectedIds]);

  if (stagingItems.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
        <ClipboardCheck className="size-12 text-slate-300" />
        <div>
          <h2 className="mb-1 text-lg font-semibold text-slate-700">
            Нет элементов на согласование
          </h2>
          <p className="max-w-md text-sm text-slate-400">
            Новые записи появляются здесь до создания задач и клиентов.
            Проверьте импорт или обновите список.
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={() => fetchStagingItems()}>
          Обновить
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex items-center gap-3 border-b border-slate-200 bg-white/70 px-6 py-3">
        <ClipboardCheck className="size-4 text-violet-500" />
        <h1 className="text-sm font-semibold text-slate-900">Согласование</h1>
        <Badge
          variant="outline"
          className="border-violet-200 bg-violet-50 text-[10px] text-violet-600"
        >
          {stagingItems.length}
        </Badge>
        <div className="flex-1" />
        <StagingColumnConfig
          visibleColumns={visibleColumns}
          onChange={setVisibleColumns}
        />
        <Button
          variant="ghost"
          size="sm"
          className="text-xs text-slate-500"
          onClick={() => fetchStagingItems()}
        >
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
              className="text-blue-500 hover:bg-blue-100 hover:text-blue-700"
              onClick={clearSelection}
              disabled={bulkLoading}
            >
              <X className="size-3.5" />
            </Button>
            <div className="h-4 w-px bg-blue-200" />
            <BulkActionSelect
              label="Сущность"
              options={ENTITY_TYPE_OPTIONS}
              onSelect={(value) => handleBulkUpdate("entity_type", value)}
              disabled={bulkLoading}
            />
            <BulkActionSelect
              label="Тип"
              options={Object.entries(TYPE_CONFIG).map(([value, config]) => ({
                value,
                label: config.label,
              }))}
              onSelect={(value) => handleBulkUpdate("type", value)}
              disabled={bulkLoading}
            />
            <BulkActionSelect
              label="Статус"
              options={Object.entries(STATUS_CONFIG).map(([value, config]) => ({
                value,
                label: config.label,
              }))}
              onSelect={(value) => handleBulkUpdate("status", value)}
              disabled={bulkLoading}
            />
            <BulkActionSelect
              label="Приоритет"
              options={Object.entries(PRIORITY_CONFIG).map(
                ([value, config]) => ({
                  value,
                  label: config.label,
                })
              )}
              onSelect={(value) => handleBulkUpdate("priority", value)}
              disabled={bulkLoading}
            />
            <BulkActionSelect
              label="Категория"
              options={localizedCategories}
              onSelect={(value) => handleBulkUpdate("category", value)}
              disabled={bulkLoading}
            />
            <div className="h-4 w-px bg-blue-200" />
            <Button
              variant="outline"
              size="sm"
              onClick={handleBulkApprove}
              disabled={bulkLoading}
            >
              <CheckCircle2 className="size-4" />
              Одобрить
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleBulkReject}
              disabled={bulkLoading}
            >
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

      <ScrollArea className="flex-1">
        <div className="space-y-4 p-4">
          {grouped.map(([batchId, items]) => {
            const isCollapsed = collapsedBatches.has(batchId);
            const allBatchSelected =
              items.length > 0 && items.every((item) => selectedIds.has(item.id));
            const selectedInBatch = items.filter((item) =>
              selectedIds.has(item.id)
            ).length;
            const batchDate = items[0]?.created_at
              ? new Date(items[0].created_at).toLocaleString("ru-RU", {
                  day: "numeric",
                  month: "short",
                  hour: "2-digit",
                  minute: "2-digit",
                })
              : "";

            return (
              <div
                key={batchId}
                className="overflow-hidden rounded-xl border border-slate-200 bg-white"
              >
                <div
                  className="flex cursor-pointer items-center gap-2 bg-slate-50/80 px-4 py-2.5 transition-colors hover:bg-slate-100/80"
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
                  <Badge
                    variant="outline"
                    className="border-slate-200 text-[10px] text-slate-400"
                  >
                    {items.length} {getItemWord(items.length)}
                  </Badge>
                  {selectedInBatch > 0 && (
                    <Badge
                      variant="outline"
                      className="border-blue-200 bg-blue-50 text-[10px] text-blue-600"
                    >
                      Выбрано: {selectedInBatch}
                    </Badge>
                  )}
                  <div className="flex-1" />
                  <div
                    className="flex items-center gap-1"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-xs text-slate-500 hover:bg-slate-100 hover:text-slate-700"
                      onClick={() => toggleBatchSelection(items)}
                    >
                      {allBatchSelected ? "Снять выделение" : "Выбрать пакет"}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      className="text-emerald-500 hover:bg-emerald-50 hover:text-emerald-600"
                      onClick={() =>
                        void Promise.all(
                          items.map((item) => approveStagingItem(item.id))
                        )
                      }
                    >
                      <CheckCircle2 className="size-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      className="text-red-400 hover:bg-red-50 hover:text-red-500"
                      onClick={() =>
                        void Promise.all(
                          items.map((item) => rejectStagingItem(item.id))
                        )
                      }
                    >
                      <XCircle className="size-3.5" />
                    </Button>
                  </div>
                </div>

                {!isCollapsed && (
                  <div className="overflow-x-auto">
                    <table className="min-w-[980px] w-full">
                      <thead className="border-y border-slate-100 bg-slate-50/70">
                        <tr className="text-left text-[10px] uppercase tracking-wider text-slate-500">
                          <th className="w-10 px-3 py-2">#</th>
                          <th className="w-[360px] px-3 py-2">Название</th>
                          {visibleColumnDefs.map((column) => (
                            <th
                              key={column.id}
                              className={`${column.widthClass} px-3 py-2`}
                            >
                              {column.label}
                            </th>
                          ))}
                          <th className="w-28 px-3 py-2 text-right">
                            Действия
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {items.map((item) => (
                          <StagingTableRow
                            key={item.id}
                            item={item}
                            categories={localizedCategories}
                            stageOptions={catalog.development_stages}
                            participantOptions={catalog.participants}
                            visibleColumns={visibleColumns}
                            selected={selectedIds.has(item.id)}
                            expanded={expandedIds.has(item.id)}
                            onToggleSelected={() => toggleSelected(item.id)}
                            onToggleExpanded={() => toggleExpanded(item.id)}
                            onApprove={() => void approveStagingItem(item.id)}
                            onReject={() => void rejectStagingItem(item.id)}
                            onDelete={() => void deleteStagingItem(item.id)}
                            onUpdate={(updates) =>
                              void updateStagingItem(item.id, updates)
                            }
                          />
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </ScrollArea>
    </div>
  );
}

function StagingTableRow({
  item,
  categories,
  stageOptions,
  participantOptions,
  visibleColumns,
  selected,
  expanded,
  onToggleSelected,
  onToggleExpanded,
  onApprove,
  onReject,
  onDelete,
  onUpdate,
}: {
  item: StagingItemParsed;
  categories: Array<{ value: string; label: string }>;
  stageOptions: Array<{
    value: string;
    label: string;
    column_id: number | null;
    lane_id: number | null;
    column_title: string | null;
    lane_title: string | null;
  }>;
  participantOptions: Array<{
    provider?: "kaiten" | null;
    remote_id?: string | null;
    name: string;
  }>;
  visibleColumns: StagingColumnId[];
  selected: boolean;
  expanded: boolean;
  onToggleSelected: () => void;
  onToggleExpanded: () => void;
  onApprove: () => void;
  onReject: () => void;
  onDelete: () => void;
  onUpdate: (
    updates: Partial<
      Pick<StagingItemParsed, "title" | "description" | "entity_type"> & {
        parsed_data: StagingParsedData;
      }
    >
  ) => void;
}) {
  const [title, setTitle] = useState(item.title);
  const [description, setDescription] = useState(item.description);

  useEffect(() => {
    setTitle(item.title);
    setDescription(item.description);
  }, [item]);

  const isItem = item.entity_type === "item";
  const descriptionPreview = truncateText(stripHtml(item.description), 160);

  const commitTitle = useCallback(() => {
    const trimmed = title.trim();
    if (!trimmed || trimmed === item.title) return;
    onUpdate({ title: trimmed });
  }, [item.title, onUpdate, title]);

  const commitDescription = useCallback(() => {
    if (description !== item.description) {
      onUpdate({ description });
    }
  }, [description, item.description, onUpdate]);

  return (
    <>
      <tr
        className={cn(
          "border-t border-slate-100 align-top",
          selected ? "bg-blue-50/70" : "hover:bg-slate-50/60"
        )}
      >
        <td className="px-3 py-2">
          <Checkbox checked={selected} onCheckedChange={onToggleSelected} />
        </td>
        <td className="min-w-[360px] px-3 py-2">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <SourceMark source={item.parsed_data.external_source} />
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onBlur={commitTitle}
                className="h-8 text-sm font-medium"
              />
            </div>
            <div className="pl-6 text-xs text-slate-500">
              {descriptionPreview || (
                <span className="text-slate-300">Описание пустое</span>
              )}
            </div>
            {item.description && (
              <button
                type="button"
                onClick={onToggleExpanded}
                className="pl-6 text-[11px] font-medium text-blue-600 hover:text-blue-700"
              >
                {expanded ? "Скрыть" : "Подробнее"}
              </button>
            )}
          </div>
        </td>

        {visibleColumns.map((column) => {
          switch (column) {
            case "entity_type":
              return (
                <td key={column} className="px-3 py-2">
                  <Select
                    value={item.entity_type}
                    onValueChange={(value) =>
                      onUpdate({ entity_type: value as StagingEntityType })
                    }
                  >
                    <SelectTrigger className="h-8 w-full text-xs">
                      <SelectValue>
                        {getEntityTypeLabel(item.entity_type)}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {ENTITY_TYPE_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </td>
              );

            case "type":
              return (
                <td key={column} className="px-3 py-2">
                  {isItem ? (
                    <NullableSelect
                      value={item.parsed_data.type}
                      options={Object.entries(TYPE_CONFIG).map(
                        ([value, config]) => ({
                          value,
                          label: config.label,
                        })
                      )}
                      onChange={(value) =>
                        onUpdate({
                          parsed_data: {
                            ...item.parsed_data,
                            type: value as ItemType | null,
                          },
                        })
                      }
                    />
                  ) : (
                    <EmptyCell />
                  )}
                </td>
              );

            case "status":
              return (
                <td key={column} className="px-3 py-2">
                  {isItem ? (
                    <NullableSelect
                      value={item.parsed_data.status}
                      options={Object.entries(STATUS_CONFIG).map(
                        ([value, config]) => ({
                          value,
                          label: config.label,
                        })
                      )}
                      onChange={(value) =>
                        onUpdate({
                          parsed_data: {
                            ...item.parsed_data,
                            status: value as ItemStatus | null,
                          },
                        })
                      }
                    />
                  ) : (
                    <EmptyCell />
                  )}
                </td>
              );

            case "priority":
              return (
                <td key={column} className="px-3 py-2">
                  {isItem ? (
                    <NullableSelect
                      value={item.parsed_data.priority}
                      options={Object.entries(PRIORITY_CONFIG).map(
                        ([value, config]) => ({
                          value,
                          label: config.label,
                        })
                      )}
                      onChange={(value) =>
                        onUpdate({
                          parsed_data: {
                            ...item.parsed_data,
                            priority: value as ItemPriority | null,
                          },
                        })
                      }
                    />
                  ) : (
                    <EmptyCell />
                  )}
                </td>
              );

            case "category":
              return (
                <td key={column} className="px-3 py-2">
                  {isItem ? (
                    <NullableSelect
                      value={item.parsed_data.category}
                      options={categories}
                      onChange={(value) =>
                        onUpdate({
                          parsed_data: {
                            ...item.parsed_data,
                            category: value as ItemCategory | null,
                          },
                        })
                      }
                    />
                  ) : (
                    <EmptyCell />
                  )}
                </td>
              );

            case "due_date":
              return (
                <td key={column} className="px-3 py-2">
                  {isItem ? (
                    <Input
                      type="date"
                      value={toDateInputValue(item.parsed_data.due_date)}
                      onChange={(e) =>
                        onUpdate({
                          parsed_data: {
                            ...item.parsed_data,
                            due_date: e.target.value || null,
                          },
                        })
                      }
                      className="h-8 text-xs"
                    />
                  ) : (
                    <EmptyCell />
                  )}
                </td>
              );

            case "development_stage":
              return (
                <td key={column} className="px-3 py-2">
                  {isItem ? (
                    <KaitenDevelopmentStageSelect
                      value={item.parsed_data.development_stage}
                      options={stageOptions}
                      onChange={(value) =>
                        onUpdate({
                          parsed_data: {
                            ...item.parsed_data,
                            development_stage: value,
                          },
                        })
                      }
                    />
                  ) : (
                    <EmptyCell />
                  )}
                </td>
              );

            case "participants":
              return (
                <td key={column} className="px-3 py-2">
                  {isItem ? (
                    <KaitenParticipantsSelect
                      value={item.parsed_data.participants ?? []}
                      options={participantOptions}
                      onChange={(participants) =>
                        onUpdate({
                          parsed_data: {
                            ...item.parsed_data,
                            participants,
                          },
                        })
                      }
                    />
                  ) : (
                    <EmptyCell />
                  )}
                </td>
              );

            default:
              return null;
          }
        })}

        <td className="px-3 py-2">
          <div className="flex items-center justify-end gap-1">
            <Button
              variant="ghost"
              size="icon-xs"
              className="text-emerald-500 hover:bg-emerald-50 hover:text-emerald-600"
              onClick={onApprove}
            >
              <CheckCircle2 className="size-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon-xs"
              className="text-red-400 hover:bg-red-50 hover:text-red-500"
              onClick={onReject}
            >
              <XCircle className="size-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon-xs"
              className="text-slate-300 hover:bg-red-50 hover:text-red-500"
              onClick={onDelete}
            >
              <Trash2 className="size-3.5" />
            </Button>
          </div>
        </td>
      </tr>

      {expanded && (
        <tr
          className={cn(
            "border-t border-slate-100",
            selected ? "bg-blue-50/40" : "bg-slate-50/40"
          )}
        >
          <td />
          <td colSpan={visibleColumns.length + 2} className="px-3 pb-3">
            <div className="space-y-3 rounded-lg border border-slate-200 bg-white p-3">
              <div className="text-xs font-medium uppercase tracking-wider text-slate-400">
                Описание
              </div>
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                onBlur={commitDescription}
                className="min-h-[140px] resize-y text-xs"
              />
              {description && (
                <div
                  className="prose prose-sm max-w-none rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600 [&_img]:my-2 [&_img]:max-h-40 [&_img]:rounded-md [&_img]:border [&_img]:border-slate-200"
                  dangerouslySetInnerHTML={{ __html: description }}
                />
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function StagingColumnConfig({
  visibleColumns,
  onChange,
}: {
  visibleColumns: StagingColumnId[];
  onChange: (columns: StagingColumnId[]) => void;
}) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;

    function handleMouseDown(event: MouseEvent) {
      const target = event.target as HTMLElement;
      if (target.closest("[data-staging-column-config]")) return;
      setOpen(false);
    }

    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, [open]);

  const toggleColumn = useCallback(
    (columnId: StagingColumnId) => {
      const isVisible = visibleColumns.includes(columnId);

      if (isVisible) {
        const next = visibleColumns.filter((id) => id !== columnId);
        if (next.length > 0) onChange(next);
        return;
      }

      const next = STAGING_COLUMNS.map((column) => column.id).filter(
        (id) => id === columnId || visibleColumns.includes(id)
      );
      onChange(next);
    },
    [onChange, visibleColumns]
  );

  return (
    <div className="relative" data-staging-column-config>
      <Button
        variant="ghost"
        size="sm"
        className="text-xs text-slate-500"
        onClick={() => setOpen((current) => !current)}
      >
        <Settings2 className="size-4" />
        Колонки
      </Button>

      {open && (
        <div className="absolute right-0 top-full z-20 mt-2 w-56 rounded-xl border border-slate-200 bg-white p-3 shadow-lg">
          <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
            Видимые столбцы
          </div>
          <div className="space-y-1">
            {STAGING_COLUMNS.map((column) => {
              const checked = visibleColumns.includes(column.id);
              const disabled = checked && visibleColumns.length === 1;

              return (
                <label
                  key={column.id}
                  className={cn(
                    "flex items-center gap-2 rounded-md px-2 py-1.5 text-xs text-slate-600 hover:bg-slate-50",
                    disabled && "cursor-not-allowed opacity-50"
                  )}
                >
                  <Checkbox
                    checked={checked}
                    disabled={disabled}
                    onCheckedChange={() => toggleColumn(column.id)}
                  />
                  <span>{column.label}</span>
                </label>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function SourceMark({ source }: { source?: StagingParsedData["external_source"] }) {
  if (source === "kaiten") {
    return (
      <span
        title="Кайтен"
        className="inline-flex size-5 items-center justify-center rounded bg-red-50 text-[11px] font-semibold text-red-600"
      >
        К
      </span>
    );
  }

  if (source === "claude") {
    return (
      <span
        title="Клод"
        className="inline-flex size-5 items-center justify-center rounded bg-orange-50 text-[11px] font-semibold text-orange-600"
      >
        С
      </span>
    );
  }

  return <span className="inline-flex size-5" />;
}

function NullableSelect({
  value,
  options,
  onChange,
}: {
  value: string | null | undefined;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string | null) => void;
}) {
  const selectedLabel =
    options.find((option) => option.value === value)?.label ?? "Не выбрано";

  return (
    <Select
      value={value ?? "__none__"}
      onValueChange={(next) => onChange(next === "__none__" ? null : next)}
    >
      <SelectTrigger className="h-8 w-full text-xs">
        <SelectValue>{selectedLabel}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="__none__">Не выбрано</SelectItem>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
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
  const selectedLabel =
    value === "__placeholder__"
      ? label
      : options.find((option) => option.value === value)?.label ?? label;

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
        <SelectValue>{selectedLabel}</SelectValue>
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

function EmptyCell() {
  return <span className="text-xs text-slate-300">--</span>;
}

function stripHtml(value: string) {
  return value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function truncateText(value: string, limit: number) {
  if (value.length <= limit) return value;
  return `${value.slice(0, limit).trim()}...`;
}

function toDateInputValue(value?: string | null) {
  if (!value) return "";
  return value.slice(0, 10);
}

function localizeCategoryLabel(label: string, fallbackId?: string) {
  const normalized = `${label || fallbackId || ""}`.trim().toLowerCase();
  if (normalized === "development") return "Разработка";
  return label || fallbackId || "";
}

function getEntityTypeLabel(value: StagingEntityType) {
  return value === "item" ? "Элемент" : "Клиент";
}

function getItemWord(count: number): string {
  const mod100 = count % 100;
  const mod10 = count % 10;
  if (mod100 >= 11 && mod100 <= 19) return "элементов";
  if (mod10 === 1) return "элемент";
  if (mod10 >= 2 && mod10 <= 4) return "элемента";
  return "элементов";
}
