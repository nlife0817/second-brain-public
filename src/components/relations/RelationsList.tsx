"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useBrainStore } from "@/lib/store";
import type { EntityType, RelationWithTarget, Item, ClientFull, ItemType, ItemStatus } from "@/types";
import { STATUS_CONFIG, PRIORITY_CONFIG, TYPE_CONFIG } from "@/types";
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
  const [creating, setCreating] = useState(false);

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

  // Lookup helpers from store
  const findItem = useCallback((id: string): Item | undefined => {
    for (const item of items) {
      if (item.id === id) return item;
      const sub = item.subtasks?.find((s) => s.id === id);
      if (sub) return sub;
    }
    return undefined;
  }, [items]);

  const findClient = useCallback((id: string): ClientFull | undefined => {
    return clients.find((c) => c.id === id);
  }, [clients]);

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

  const handleAdd = useCallback(async (targetType: EntityType, targetId: string) => {
    let relationTypeId: string | null = null;
    if (targetType === "client") {
      let clientType = relationTypes.find((rt) => rt.name === "Клиент");
      if (!clientType) {
        clientType = await createRelationType("Клиент", "#22c55e", "User");
      }
      relationTypeId = clientType.id;
    }
    await createRelation(entityType, entityId, targetType, targetId, relationTypeId);
    setSearch("");
    setSearchResults([]);
    setAddOpen(false);
    await loadRelations();
  }, [createRelation, createRelationType, entityType, entityId, relationTypes, loadRelations]);

  const handleCreateAndLink = useCallback(async () => {
    if (!newTitle.trim() || creating) return;
    setCreating(true);
    try {
      const created = await createItem({ title: newTitle.trim(), type: newType, status: newStatus });
      await createRelation(entityType, entityId, "item", created.id);
      setSearch("");
      setSearchResults([]);
      setNewTitle("");
      setNewType("task");
      setNewStatus("inbox");
      setShowCreateForm(false);
      setAddOpen(false);
      await loadRelations();
    } finally {
      setCreating(false);
    }
  }, [newTitle, newType, newStatus, creating, createItem, createRelation, entityType, entityId, loadRelations]);

  const handleDelete = useCallback(async (relationId: string) => {
    await deleteRelation(relationId);
    await loadRelations();
  }, [deleteRelation, loadRelations]);

  const handleTypeChange = useCallback(async (relationId: string, typeId: string) => {
    await updateRelationType_(relationId, typeId === "__none__" ? null : typeId);
    await loadRelations();
  }, [updateRelationType_, loadRelations]);

  const handleClickTarget = useCallback((rel: RelationWithTarget) => {
    // Close current detail before opening target
    if (entityType === "item") closeDetail();
    else closeClientDetail();

    // Open target after a tick so the closing animation doesn't conflict
    setTimeout(() => {
      if (rel.target_type === "item") openDetail(rel.target_id);
      else openClientDetail(rel.target_id);
    }, 0);
  }, [entityType, closeDetail, closeClientDetail, openDetail, openClientDetail]);

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
        <Popover open={addOpen} onOpenChange={setAddOpen}>
          <PopoverTrigger
            render={<Button variant="ghost" size="icon-xs" className="text-slate-400 hover:text-slate-600" />}
          >
            <Plus className="size-3.5" />
          </PopoverTrigger>
          <PopoverContent className="w-80 p-0" align="end">
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
                    onKeyDown={(e) => { if (e.key === "Enter") handleCreateAndLink(); if (e.key === "Escape") setShowCreateForm(false); }}
                  />
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
                    <Button size="sm" className="h-6 text-[10px] px-2" disabled={!newTitle.trim() || creating} onClick={handleCreateAndLink}>
                      {creating ? "..." : "Создать"}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </PopoverContent>
        </Popover>
      </div>

      {loading && relations.length === 0 && (
        <div className="text-xs text-slate-400">Загрузка...</div>
      )}

      {relations.length > 0 && (
        <div className="space-y-1">
          {relations.map((rel) => {
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
