"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useBrainStore, useCategoryConfig } from "@/lib/store";
import type { EntityType, RelationWithTarget, Item, ClientFull, ItemType, ItemStatus, ItemPriority, ItemCategory } from "@/types";
import { STATUS_CONFIG, PRIORITY_CONFIG, TYPE_CONFIG } from "@/types";
import { format, parseISO } from "date-fns";
import { ru } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
import {
  Select,
  SelectTrigger,
  SelectContent,
  SelectItem,
  SelectValue,
} from "@/components/ui/select";
import {
  Link,
  Plus,
  X,
  Search,
  FileText,
  User,
  ChevronDown,
  ChevronUp,
  ArrowUpDown,
  Calendar,
  Clock,
  EyeOff,
  Eye,
} from "lucide-react";

interface RelationsListProps {
  entityType: EntityType;
  entityId: string;
}

/* Brief info badge for an item */
function ItemBrief({ item }: { item: Item }) {
  const statusCfg = STATUS_CONFIG[item.status];
  const priorityCfg = PRIORITY_CONFIG[item.priority];
  const typeCfg = TYPE_CONFIG[item.type];
  const dueDate = item.due_date ? parseISO(item.due_date) : null;
  return (
    <div className="flex items-center gap-1 shrink-0">
      <span
        className={cn("size-1.5 rounded-full shrink-0",
          item.status === "inbox" && "bg-gray-400",
          item.status === "todo" && "bg-blue-400",
          item.status === "in_progress" && "bg-amber-400",
          item.status === "review" && "bg-purple-400",
          item.status === "done" && "bg-emerald-400",
        )}
        title={statusCfg.label}
      />
      <span className="text-[10px] text-slate-400">{typeCfg.label}</span>
      {item.priority !== "none" && (
        <span className="text-[10px] leading-none">{priorityCfg.icon}</span>
      )}
      {dueDate && (
        <span className="text-[9px] text-slate-400 tabular-nums" title={`Дедлайн: ${format(dueDate, "d MMM yyyy", { locale: ru })}`}>
          {format(dueDate, "d.MM", { locale: ru })}
        </span>
      )}
    </div>
  );
}

/* Brief info for a client */
function ClientBrief({ client }: { client: ClientFull }) {
  return (
    <div className="flex items-center gap-1 shrink-0">
      {client.status ? (
        <Badge
          variant="outline"
          className="px-1 py-0 text-[9px] leading-tight"
          style={{
            borderColor: `${client.status.color}40`,
            color: client.status.color,
            backgroundColor: `${client.status.color}10`,
          }}
        >
          {client.status.name}
        </Badge>
      ) : (
        <span className="text-[10px] text-slate-300">клиент</span>
      )}
    </div>
  );
}

export function RelationsList({ entityType, entityId }: RelationsListProps) {
  const [relations, setRelations] = useState<RelationWithTarget[]>([]);
  const [loading, setLoading] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [searchResults, setSearchResults] = useState<{ type: EntityType; id: string; title: string }[]>([]);
  const [searching, setSearching] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newType, setNewType] = useState<ItemType>("task");
  const [newStatus, setNewStatus] = useState<ItemStatus>("inbox");
  const [newPriority, setNewPriority] = useState<ItemPriority>("none");
  const [newCategory, setNewCategory] = useState<ItemCategory>("other");
  const [newDueDate, setNewDueDate] = useState("");
  const [newTags, setNewTags] = useState<string[]>([]);
  const [newDescription, setNewDescription] = useState("");
  const [showExtraFields, setShowExtraFields] = useState(true);
  const [creating, setCreating] = useState(false);

  type RelSortMode = "default" | "status" | "due_date" | "title";
  const [relSort, setRelSort] = useState<RelSortMode>("default");
  const [hideDone, setHideDone] = useState(false);

  const fetchRelations = useBrainStore((s) => s.fetchRelations);
  const createRelation = useBrainStore((s) => s.createRelation);
  const createRelationType = useBrainStore((s) => s.createRelationType);
  const deleteRelation = useBrainStore((s) => s.deleteRelation);
  const updateRelationType_ = useBrainStore((s) => s.updateRelationType_);
  const createItem = useBrainStore((s) => s.createItem);
  const relationTypes = useBrainStore((s) => s.relationTypes);
  const items = useBrainStore((s) => s.items);
  const clients = useBrainStore((s) => s.clients);
  const openDetail = useBrainStore((s) => s.openDetail);
  const openClientDetail = useBrainStore((s) => s.openClientDetail);
  const closeDetail = useBrainStore((s) => s.closeDetail);
  const closeClientDetail = useBrainStore((s) => s.closeClientDetail);
  const tags = useBrainStore((s) => s.tags);
  const categories = useBrainStore((s) => s.categories);
  const categoryConfig = useCategoryConfig();

  const loadRelations = useCallback(async () => {
    setLoading(true);
    const data = await fetchRelations(entityType, entityId);
    setRelations(data);
    setLoading(false);
  }, [fetchRelations, entityType, entityId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadRelations();
  }, [loadRelations]);

  // Lookup helpers from store — O(1) Maps instead of O(N) linear search
  const itemMap = useMemo(() => {
    const map = new Map<string, Item>();
    for (const item of items) {
      map.set(item.id, item);
      if (item.subtasks) {
        for (const sub of item.subtasks) {
          map.set(sub.id, sub);
        }
      }
    }
    return map;
  }, [items]);

  const clientMap = useMemo(() => {
    const map = new Map<string, ClientFull>();
    for (const c of clients) map.set(c.id, c);
    return map;
  }, [clients]);

  const findItem = useCallback((id: string): Item | undefined => {
    return itemMap.get(id);
  }, [itemMap]);

  const findClient = useCallback((id: string): ClientFull | undefined => {
    return clientMap.get(id);
  }, [clientMap]);

  // Search across items and clients — deduplicated
  const performSearch = useCallback((q: string) => {
    if (!q.trim()) { setSearchResults([]); return; }
    const lower = q.toLowerCase();

    const seen = new Set<string>();
    const results: { type: EntityType; id: string; title: string }[] = [];

    // Existing relations + self to exclude
    for (const r of relations) seen.add(`${r.target_type}:${r.target_id}`);
    seen.add(`${entityType}:${entityId}`);

    const addResult = (type: EntityType, id: string, title: string) => {
      const key = `${type}:${id}`;
      if (seen.has(key)) return;
      seen.add(key);
      results.push({ type, id, title });
    };

    for (const item of items) {
      if (item.title.toLowerCase().includes(lower)) addResult("item", item.id, item.title);
      if (item.subtasks) {
        for (const sub of item.subtasks) {
          if (sub.title.toLowerCase().includes(lower)) addResult("item", sub.id, sub.title);
        }
      }
      if (results.length >= 10) break;
    }

    for (const client of clients) {
      if (client.name.toLowerCase().includes(lower)) addResult("client", client.id, client.name);
      if (results.length >= 15) break;
    }

    setSearchResults(results);
    setSearching(false);
  }, [items, clients, relations, entityType, entityId]);

  const onSearchChange = useCallback((value: string) => {
    setSearch(value);
    setSearching(true);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => performSearch(value), 150);
  }, [performSearch]);

  // Helper: get or create "Клиент" relation type
  const getOrCreateClientRelationType = useCallback(async () => {
    let clientType = relationTypes.find((rt) => rt.name === "Клиент");
    if (!clientType) {
      clientType = await createRelationType("Клиент", "#22c55e", "User", 1);
    }
    return clientType.id;
  }, [relationTypes, createRelationType]);

  const handleAdd = useCallback(async (targetType: EntityType, targetId: string) => {
    let relationTypeId: string | null = null;
    if (targetType === "client" || entityType === "client") {
      relationTypeId = await getOrCreateClientRelationType();
    }
    await createRelation(entityType, entityId, targetType, targetId, relationTypeId);
    setSearch("");
    setSearchResults([]);
    setAddOpen(false);
    await loadRelations();
  }, [createRelation, getOrCreateClientRelationType, entityType, entityId, loadRelations]);

  const handleCreateAndLink = useCallback(async () => {
    if (!newTitle.trim() || creating) return;
    setCreating(true);
    try {
      const created = await createItem({
        title: newTitle.trim(),
        type: newType,
        status: newStatus,
        priority: newPriority,
        category: newCategory,
        description: newDescription.trim() || undefined,
        due_date: newDueDate || null,
        tags: newTags.length > 0 ? newTags : undefined,
      });

      // If creating from a client entity, auto-set "Клиент" relation type
      let relationTypeId: string | null = null;
      if (entityType === "client") {
        relationTypeId = await getOrCreateClientRelationType();
      }

      await createRelation(entityType, entityId, "item", created.id, relationTypeId);
      setSearch("");
      setSearchResults([]);
      setNewTitle("");
      setNewType("task");
      setNewStatus("inbox");
      setNewPriority("none");
      setNewCategory("other");
      setNewDueDate("");
      setNewTags([]);
      setNewDescription("");
      setShowExtraFields(false);
      setShowCreateForm(false);
      setAddOpen(false);
      await loadRelations();
    } finally {
      setCreating(false);
    }
  }, [newTitle, newType, newStatus, newPriority, newCategory, newDescription, newDueDate, newTags, creating, createItem, createRelation, entityType, entityId, getOrCreateClientRelationType, loadRelations]);

  const handleDelete = useCallback(async (relationId: string) => {
    await deleteRelation(relationId);
    await loadRelations();
  }, [deleteRelation, loadRelations]);

  const handleTypeChange = useCallback(async (relationId: string, typeId: string) => {
    await updateRelationType_(relationId, typeId === "__none__" ? null : typeId);
    await loadRelations();
  }, [updateRelationType_, loadRelations]);

  const handleClickTarget = useCallback((rel: RelationWithTarget) => {
    if (rel.target_type === "item") {
      if (entityType === "item") {
        // item -> item: close current, open target
        closeDetail();
        setTimeout(() => openDetail(rel.target_id), 0);
      } else {
        // client -> item: open task detail on top (don't close client modal)
        openDetail(rel.target_id);
      }
    } else {
      // Opening a client target
      if (entityType === "client") {
        closeClientDetail();
        setTimeout(() => openClientDetail(rel.target_id), 0);
      } else {
        closeDetail();
        setTimeout(() => openClientDetail(rel.target_id), 0);
      }
    }
  }, [entityType, closeDetail, closeClientDetail, openDetail, openClientDetail]);

  const toggleTag = useCallback((tagId: string) => {
    setNewTags((prev) => prev.includes(tagId) ? prev.filter((t) => t !== tagId) : [...prev, tagId]);
  }, []);

  // Sort relations
  const STATUS_WEIGHT: Record<string, number> = {
    in_progress: 0, review: 1, todo: 2, inbox: 3, done: 4, archived: 5,
  };

  const sortedRelations = useMemo(() => {
    let list = relations;
    if (hideDone) {
      list = list.filter((rel) => {
        if (rel.target_type !== "item") return true;
        const item = findItem(rel.target_id);
        return !item || item.status !== "done";
      });
    }
    if (relSort === "default") return list;
    const sorted = [...list];
    sorted.sort((a, b) => {
      const aItem = a.target_type === "item" ? findItem(a.target_id) : undefined;
      const bItem = b.target_type === "item" ? findItem(b.target_id) : undefined;
      switch (relSort) {
        case "status": {
          const aW = aItem ? (STATUS_WEIGHT[aItem.status] ?? 99) : 99;
          const bW = bItem ? (STATUS_WEIGHT[bItem.status] ?? 99) : 99;
          return aW - bW;
        }
        case "due_date": {
          const aD = aItem?.due_date ? new Date(aItem.due_date).getTime() : Infinity;
          const bD = bItem?.due_date ? new Date(bItem.due_date).getTime() : Infinity;
          return aD - bD;
        }
        case "title":
          return (a.target_title || "").localeCompare(b.target_title || "", "ru");
        default:
          return 0;
      }
    });
    return sorted;
  }, [relations, relSort, hideDone, findItem]);

  const cycleSortMode = useCallback(() => {
    setRelSort((prev) => {
      const modes: RelSortMode[] = ["default", "status", "due_date", "title"];
      const idx = modes.indexOf(prev);
      return modes[(idx + 1) % modes.length];
    });
  }, []);

  const sortLabel: Record<RelSortMode, string> = {
    default: "Без сортировки",
    status: "По статусу",
    due_date: "По дедлайну",
    title: "По названию",
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-medium text-slate-700">
          <Link className="size-4 text-slate-400" />
          Связи
          {relations.length > 0 && (
            <span className="text-xs text-slate-400">({relations.length})</span>
          )}
        </div>
        <div className="flex items-center gap-0.5">
          {relations.length > 1 && (
            <>
              <button
                onClick={() => setHideDone(!hideDone)}
                className={cn(
                  "flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] transition-colors",
                  hideDone
                    ? "text-violet-600 bg-violet-50 hover:bg-violet-100"
                    : "text-slate-400 hover:text-slate-600 hover:bg-slate-100"
                )}
                title={hideDone ? "Показать готовые" : "Скрыть готовые"}
              >
                {hideDone ? <EyeOff className="size-3" /> : <Eye className="size-3" />}
              </button>
              <button
                onClick={cycleSortMode}
                className={cn(
                  "flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] transition-colors",
                  relSort !== "default"
                    ? "text-violet-600 bg-violet-50 hover:bg-violet-100"
                    : "text-slate-400 hover:text-slate-600 hover:bg-slate-100"
                )}
                title={sortLabel[relSort]}
              >
                <ArrowUpDown className="size-3" />
                {relSort !== "default" && (
                  <span>{sortLabel[relSort]}</span>
                )}
              </button>
            </>
          )}
        <Popover open={addOpen} onOpenChange={setAddOpen}>
          <PopoverTrigger
            render={<Button variant="ghost" size="icon-xs" className="text-slate-400 hover:text-slate-600" />}
          >
            <Plus className="size-3.5" />
          </PopoverTrigger>
          <PopoverContent className="w-[420px] p-0" align="end">
            <div className="p-2">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-slate-400" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => onSearchChange(e.target.value)}
                  placeholder="Поиск задач, заметок, клиентов..."
                  className="w-full rounded-md border border-slate-200 bg-white py-1.5 pl-8 pr-3 text-sm placeholder:text-slate-400 focus:border-violet-300 focus:outline-none focus:ring-1 focus:ring-violet-300"
                  autoFocus
                />
              </div>
            </div>
            <div className="max-h-60 overflow-auto border-t border-slate-100">
              {searching && <div className="px-3 py-2 text-xs text-slate-400">Поиск...</div>}
              {!searching && search && searchResults.length === 0 && (
                <div className="px-3 py-4 text-center text-xs text-slate-400">Ничего не найдено</div>
              )}
              {!searching && searchResults.map((r) => {
                const itemData = r.type === "item" ? findItem(r.id) : undefined;
                const clientData = r.type === "client" ? findClient(r.id) : undefined;
                return (
                  <button
                    key={`${r.type}:${r.id}`}
                    onClick={() => handleAdd(r.type, r.id)}
                    className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm hover:bg-slate-50 transition-colors"
                  >
                    {r.type === "item" ? (
                      <FileText className="size-3.5 text-slate-400 shrink-0" />
                    ) : (
                      <User className="size-3.5 text-violet-400 shrink-0" />
                    )}
                    <span className="truncate flex-1">{r.title}</span>
                    {itemData && <ItemBrief item={itemData} />}
                    {clientData && <ClientBrief client={clientData} />}
                  </button>
                );
              })}
              {!search && !showCreateForm && (
                <div className="px-3 py-4 text-center text-xs text-slate-400">Начните вводить для поиска</div>
              )}
            </div>

            {/* Create + link inline form */}
            <div className="border-t border-slate-100">
              {!showCreateForm ? (
                <button
                  onClick={() => { setShowCreateForm(true); setNewTitle(search); }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-xs text-violet-600 hover:bg-violet-50 transition-colors"
                >
                  <Plus className="size-3.5" />
                  Создать задачу и привязать
                </button>
              ) : (
                <div className="p-2 space-y-2">
                  <Input
                    value={newTitle}
                    onChange={(e) => setNewTitle(e.target.value)}
                    placeholder="Заголовок задачи..."
                    className="h-7 text-sm"
                    autoFocus
                    onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) handleCreateAndLink(); if (e.key === "Escape") setShowCreateForm(false); }}
                  />
                  {/* Row 1: type + status */}
                  <div className="flex items-center gap-1.5">
                    <Select value={newType} onValueChange={(v) => setNewType(v as ItemType)}>
                      <SelectTrigger className="h-6 text-[10px] w-auto flex-1">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {(Object.entries(TYPE_CONFIG) as [ItemType, { label: string }][]).map(([k, v]) => (
                          <SelectItem key={k} value={k}>{v.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Select value={newStatus} onValueChange={(v) => setNewStatus(v as ItemStatus)}>
                      <SelectTrigger className="h-6 text-[10px] w-auto flex-1">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {(Object.entries(STATUS_CONFIG) as [ItemStatus, { label: string; color: string }][]).map(([k, v]) => (
                          <SelectItem key={k} value={k}>{v.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  {/* Row 2: priority + category */}
                  <div className="flex items-center gap-1.5">
                    <Select value={newPriority} onValueChange={(v) => setNewPriority(v as ItemPriority)}>
                      <SelectTrigger className="h-6 text-[10px] w-auto flex-1">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {(Object.entries(PRIORITY_CONFIG) as [ItemPriority, { label: string; icon: string }][]).map(([k, v]) => (
                          <SelectItem key={k} value={k}>{v.icon} {v.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Select value={newCategory} onValueChange={(v) => setNewCategory(v as ItemCategory)}>
                      <SelectTrigger className="h-6 text-[10px] w-auto flex-1">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {categories.map((cat) => (
                          <SelectItem key={cat.id} value={cat.id}>{categoryConfig[cat.id]?.label ?? cat.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Toggle extra fields */}
                  <button
                    type="button"
                    onClick={() => setShowExtraFields(!showExtraFields)}
                    className="flex items-center gap-1 text-[10px] text-slate-400 hover:text-slate-600 transition-colors"
                  >
                    {showExtraFields ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
                    {showExtraFields ? "Скрыть" : "Ещё параметры"}
                  </button>

                  {showExtraFields && (
                    <div className="space-y-2">
                      {/* Due date */}
                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px] text-slate-500 w-14 shrink-0">Дедлайн</span>
                        <input
                          type="date"
                          value={newDueDate}
                          onChange={(e) => setNewDueDate(e.target.value)}
                          className="h-6 flex-1 rounded border border-slate-200 px-1.5 text-[10px] text-slate-700 focus:border-violet-300 focus:outline-none focus:ring-1 focus:ring-violet-300"
                        />
                        {newDueDate && (
                          <button
                            type="button"
                            onClick={() => setNewDueDate("")}
                            className="text-slate-300 hover:text-slate-500"
                          >
                            <X className="size-3" />
                          </button>
                        )}
                      </div>

                      {/* Tags */}
                      {tags.length > 0 && (
                        <div>
                          <span className="text-[10px] text-slate-500 block mb-1">Теги</span>
                          <div className="flex flex-wrap gap-1">
                            {tags.map((tag) => (
                              <button
                                key={tag.id}
                                type="button"
                                onClick={() => toggleTag(tag.id)}
                                className={cn(
                                  "rounded px-1.5 py-0 text-[10px] font-medium transition-colors border",
                                  newTags.includes(tag.id)
                                    ? "border-current"
                                    : "border-transparent opacity-60 hover:opacity-100"
                                )}
                                style={{
                                  backgroundColor: `${tag.color}18`,
                                  color: tag.color,
                                }}
                              >
                                {tag.name}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Description */}
                      <div>
                        <span className="text-[10px] text-slate-500 block mb-1">Описание</span>
                        <textarea
                          value={newDescription}
                          onChange={(e) => setNewDescription(e.target.value)}
                          placeholder="Описание задачи..."
                          className="w-full rounded border border-slate-200 px-2 py-1 text-[11px] text-slate-700 placeholder:text-slate-400 focus:border-violet-300 focus:outline-none focus:ring-1 focus:ring-violet-300 resize-none"
                          rows={2}
                        />
                      </div>
                    </div>
                  )}

                  <Button size="sm" className="h-6 text-[10px] px-2 w-full" disabled={!newTitle.trim() || creating} onClick={handleCreateAndLink}>
                    {creating ? "..." : "Создать"}
                  </Button>
                </div>
              )}
            </div>
          </PopoverContent>
        </Popover>
        </div>
      </div>

      {loading && relations.length === 0 && (
        <div className="text-xs text-slate-400">Загрузка...</div>
      )}

      {sortedRelations.length > 0 && (
        <div className="space-y-1">
          {sortedRelations.map((rel) => {
            const itemData = rel.target_type === "item" ? findItem(rel.target_id) : undefined;
            const clientData = rel.target_type === "client" ? findClient(rel.target_id) : undefined;

            return (
              <div
                key={rel.id}
                className="group flex items-center gap-2 rounded-md border border-slate-100 bg-white px-2.5 py-1.5 text-sm hover:border-slate-200 transition-colors"
              >
                {rel.target_type === "item" ? (
                  <FileText className="size-3.5 text-slate-400 shrink-0" />
                ) : (
                  <User className="size-3.5 text-violet-400 shrink-0" />
                )}

                <button
                  onClick={() => handleClickTarget(rel)}
                  className="flex-1 min-w-0 text-left hover:text-violet-600 transition-colors"
                >
                  <span className="truncate block text-slate-700 text-sm leading-snug">
                    {rel.target_title || "Без названия"}
                  </span>
                </button>

                {/* Brief info about the target */}
                {itemData && <ItemBrief item={itemData} />}
                {clientData && <ClientBrief client={clientData} />}

                {/* Relation type badge/selector */}
                {relationTypes.length > 0 && (
                  <Select
                    value={rel.relation_type_id ?? "__none__"}
                    onValueChange={(v) => { if (v) handleTypeChange(rel.id, v); }}
                  >
                    <SelectTrigger className="h-5 w-auto min-w-0 gap-0.5 border-0 bg-transparent px-1 text-[10px] shadow-none hover:bg-slate-50">
                      {rel.relation_type ? (
                        <Badge
                          variant="outline"
                          className="px-1.5 py-0 text-[10px] leading-tight"
                          style={{
                            borderColor: `${rel.relation_type.color}40`,
                            color: rel.relation_type.color,
                            backgroundColor: `${rel.relation_type.color}10`,
                          }}
                        >
                          {rel.relation_type.name}
                        </Badge>
                      ) : (
                        <span className="text-slate-300">тип</span>
                      )}
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">
                        <span className="text-slate-400">Без типа</span>
                      </SelectItem>
                      {relationTypes.map((rt) => (
                        <SelectItem key={rt.id} value={rt.id}>
                          <span style={{ color: rt.color }}>{rt.name}</span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}

                <button
                  onClick={() => handleDelete(rel.id)}
                  className="opacity-0 group-hover:opacity-100 text-slate-300 hover:text-red-400 transition-all"
                >
                  <X className="size-3.5" />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
