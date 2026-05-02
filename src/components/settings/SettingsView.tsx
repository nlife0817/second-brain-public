"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useBrainStore } from "@/lib/store";
import type {
  IntegrationSettings,
  KaitenBoardOption,
  KaitenImportResult,
  KaitenSpace,
  RelationType,
  SyncFieldMapping,
  SyncProfile,
} from "@/types";
import { KAITEN_DEFAULT_FIELD_MAPPINGS } from "@/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import {
  Plus,
  Trash2,
  Pencil,
  Check,
  X,
  Link,
  Palette,
  Loader2,
  RefreshCw,
  Download,
  PlugZap,
  Settings2,
  FolderKanban,
  Database,
  ChevronUp,
  ChevronDown,
} from "lucide-react";
import { CategoryManager } from "./CategoryManager";
import { OrderableListSection } from "./OrderableListSection";
import { UserManager } from "./UserManager";
import { NotificationsSettings } from "./NotificationsSettings";
import { TimingSettingsCard } from "@/components/timing/TimingSettings";
import { Tag, Layers, Users, ListChecks } from "lucide-react";

const PRESET_COLORS = [
  "#6b7280", "#ef4444", "#f97316", "#eab308", "#22c55e",
  "#06b6d4", "#3b82f6", "#8b5cf6", "#ec4899", "#14b8a6",
];

const DEFAULT_SETTINGS: IntegrationSettings = {
  provider: "kaiten",
  enabled: false,
  company_domain: "",
  api_base_url: "",
  has_token: false,
  token_masked: null,
  default_import_target: "staging",
  created_at: "",
  updated_at: "",
};

type KaitenProfileWithImport = SyncProfile & {
  last_import?: KaitenImportResult | null;
};

type BoardsResponse = {
  spaces: KaitenSpace[];
  boards: KaitenBoardOption[];
  selected_space_id?: number | null;
  error?: string;
};

type FieldMappingsResponse = {
  defaults: typeof KAITEN_DEFAULT_FIELD_MAPPINGS;
  mappings: SyncFieldMapping[];
};

function TagsSection() {
  const tags = useBrainStore((s) => s.tags);
  const createTag = useBrainStore((s) => s.createTag);
  const updateTag = useBrainStore((s) => s.updateTag);
  const deleteTag = useBrainStore((s) => s.deleteTag);

  return (
    <section className="rounded-xl border border-slate-200/80 bg-white p-3.5 shadow-sm">
      <div className="mb-2 flex items-center gap-2">
        <Tag className="size-4 text-violet-500" />
        <span className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-500">Теги</span>
        {tags.length > 0 && <span className="text-xs text-slate-400">({tags.length})</span>}
      </div>
      <OrderableListSection
        items={tags}
        onCreate={(name, color) => createTag(name, color)}
        onUpdate={(id, updates) => updateTag(id, updates)}
        onDelete={(id) => deleteTag(id)}
        hasColor
        emptyText="Нет тегов"
        addPlaceholder="Название тега..."
      />
    </section>
  );
}

function TaskStatusesSection() {
  const statuses = useBrainStore((s) => s.itemStatuses);
  const create = useBrainStore((s) => s.createItemStatus);
  const update = useBrainStore((s) => s.updateItemStatus);
  const del = useBrainStore((s) => s.deleteItemStatus);

  const handleCreate = useCallback(async (name: string, color?: string) => {
    await create(name, color);
  }, [create]);

  const handleUpdate = useCallback(async (id: string, updates: Partial<{ name: string; color: string; position: number }>) => {
    await update(id, updates);
  }, [update]);

  const handleDelete = useCallback(async (id: string) => {
    const result = await del(id);
    if (!result.ok && result.message) {
      alert(result.message);
    }
  }, [del]);

  return (
    <section className="rounded-xl border border-slate-200/80 bg-white p-3.5 shadow-sm">
      <div className="mb-2 flex items-center gap-2">
        <ListChecks className="size-4 text-emerald-500" />
        <span className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-500">Статусы задач</span>
        {statuses.length > 0 && <span className="text-xs text-slate-400">({statuses.length})</span>}
      </div>
      <p className="mb-2 text-[11px] leading-snug text-slate-400">
        Переименуйте, переставьте местами или добавьте свои статусы. Удалить можно только тот статус,
        который не используется ни одной задачей.
      </p>
      <OrderableListSection
        items={statuses}
        onCreate={handleCreate}
        onUpdate={handleUpdate}
        onDelete={handleDelete}
        hasColor
        emptyText="Нет статусов"
        addPlaceholder="Название статуса..."
      />
    </section>
  );
}

function DevelopmentStagesSection() {
  const stages = useBrainStore((s) => s.developmentStages);
  const create = useBrainStore((s) => s.createDevelopmentStage);
  const update = useBrainStore((s) => s.updateDevelopmentStage);
  const del = useBrainStore((s) => s.deleteDevelopmentStage);

  return (
    <section className="rounded-xl border border-slate-200/80 bg-white p-3.5 shadow-sm">
      <div className="mb-2 flex items-center gap-2">
        <Layers className="size-4 text-violet-500" />
        <span className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-500">Этапы разработки</span>
        {stages.length > 0 && <span className="text-xs text-slate-400">({stages.length})</span>}
      </div>
      <OrderableListSection
        items={stages}
        onCreate={(name) => create(name)}
        onUpdate={(id, updates) => update(id, updates)}
        onDelete={(id) => del(id)}
        emptyText="Нет этапов"
        addPlaceholder="Название этапа..."
      />
    </section>
  );
}

function DevelopmentParticipantsSection() {
  const participants = useBrainStore((s) => s.allParticipants);
  const create = useBrainStore((s) => s.createParticipant);
  const update = useBrainStore((s) => s.updateParticipant);
  const del = useBrainStore((s) => s.deleteParticipant);

  // Map DevelopmentParticipant to OrderableItem
  const items = participants.map((p) => ({
    id: p.id,
    name: p.name,
    position: p.position,
  }));

  return (
    <section className="rounded-xl border border-slate-200/80 bg-white p-3.5 shadow-sm">
      <div className="mb-2 flex items-center gap-2">
        <Users className="size-4 text-violet-500" />
        <span className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-500">Участники</span>
        {participants.length > 0 && <span className="text-xs text-slate-400">({participants.length})</span>}
      </div>
      <OrderableListSection
        items={items}
        onCreate={(name) => create(name)}
        onUpdate={(id, updates) => update(id, updates)}
        onDelete={(id) => del(id)}
        emptyText="Нет участников"
        addPlaceholder="Имя участника..."
      />
    </section>
  );
}

function CrmSystemsSection() {
  const crmSystems = useBrainStore((s) => s.crmSystems);
  const createCrm = useBrainStore((s) => s.createCrmSystem);
  const updateCrm = useBrainStore((s) => s.updateCrmSystem);
  const deleteCrm = useBrainStore((s) => s.deleteCrmSystem);
  const [newName, setNewName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");

  const sorted = [...crmSystems].sort((a, b) => a.position - b.position);

  const handleCreate = async () => {
    if (!newName.trim()) return;
    await createCrm(newName.trim());
    setNewName("");
  };

  const handleUpdate = async (id: string) => {
    if (!editName.trim()) return;
    await updateCrm(id, { name: editName.trim() });
    setEditingId(null);
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Удалить эту CRM-систему?")) return;
    await deleteCrm(id);
  };

  const move = async (idx: number, dir: -1 | 1) => {
    const target = idx + dir;
    if (target < 0 || target >= sorted.length) return;
    const a = sorted[idx];
    const b = sorted[target];
    await updateCrm(a.id, { position: b.position });
    await updateCrm(b.id, { position: a.position });
  };

  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <Database className="size-4 text-violet-500" />
        <span className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-500">CRM-системы</span>
        {sorted.length > 0 && <span className="text-xs text-slate-400">({sorted.length})</span>}
      </div>

      {sorted.length > 0 && (
        <div className="flex flex-col gap-1 mb-3">
          {sorted.map((crm, idx) => (
            <div key={crm.id} className="group flex items-center gap-2 rounded-lg border border-slate-100 px-3 py-1.5">
              {editingId === crm.id ? (
                <>
                  <Input
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    className="h-7 flex-1 text-sm"
                    autoFocus
                    onKeyDown={(e) => { if (e.key === "Enter") handleUpdate(crm.id); if (e.key === "Escape") setEditingId(null); }}
                  />
                  <Button size="icon-xs" variant="ghost" onClick={() => handleUpdate(crm.id)} className="text-green-600">
                    <Check className="size-3.5" />
                  </Button>
                  <Button size="icon-xs" variant="ghost" onClick={() => setEditingId(null)}>
                    <X className="size-3.5 text-slate-400" />
                  </Button>
                </>
              ) : (
                <>
                  <span className="flex-1 text-sm text-slate-700">{crm.name}</span>
                  <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Button size="icon-xs" variant="ghost" disabled={idx === 0} onClick={() => move(idx, -1)}>
                      <ChevronUp className="size-3.5 text-slate-400" />
                    </Button>
                    <Button size="icon-xs" variant="ghost" disabled={idx === sorted.length - 1} onClick={() => move(idx, 1)}>
                      <ChevronDown className="size-3.5 text-slate-400" />
                    </Button>
                    <Button size="icon-xs" variant="ghost" onClick={() => { setEditingId(crm.id); setEditName(crm.name); }}>
                      <Pencil className="size-3.5 text-slate-400" />
                    </Button>
                    <Button size="icon-xs" variant="ghost" onClick={() => handleDelete(crm.id)}>
                      <Trash2 className="size-3.5 text-slate-400 hover:text-red-500" />
                    </Button>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center gap-2">
        <Input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="Название CRM-системы..."
          className="h-8 flex-1 text-sm"
          onKeyDown={(e) => { if (e.key === "Enter") handleCreate(); }}
        />
        <Button size="sm" onClick={handleCreate} disabled={!newName.trim()}>
          <Plus className="size-4 mr-1" /> Добавить
        </Button>
      </div>
    </div>
  );
}

function RelationTypeRow({
  rt,
  onUpdate,
  onDelete,
}: {
  rt: RelationType;
  onUpdate: (id: string, updates: Partial<RelationType>) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(rt.name);
  const [color, setColor] = useState(rt.color);
  const [showColors, setShowColors] = useState(false);

  const handleSave = useCallback(async () => {
    if (!name.trim()) return;
    await onUpdate(rt.id, { name: name.trim(), color });
    setEditing(false);
  }, [rt.id, name, color, onUpdate]);

  const handleCancel = () => {
    setName(rt.name);
    setColor(rt.color);
    setEditing(false);
    setShowColors(false);
  };

  if (editing) {
    return (
      <div className="flex flex-col gap-2 rounded-lg border border-violet-200 bg-violet-50/30 p-3">
        <div className="flex items-center gap-2">
          <div
            className="size-6 cursor-pointer rounded-md border border-slate-200 shrink-0"
            style={{ backgroundColor: color }}
            onClick={() => setShowColors(!showColors)}
          />
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="h-8 flex-1 text-sm"
            placeholder="Название типа..."
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSave();
              if (e.key === "Escape") handleCancel();
            }}
          />
          <Button variant="ghost" size="icon-xs" onClick={handleSave} className="text-emerald-600 hover:text-emerald-700">
            <Check className="size-3.5" />
          </Button>
          <Button variant="ghost" size="icon-xs" onClick={handleCancel} className="text-slate-400 hover:text-slate-600">
            <X className="size-3.5" />
          </Button>
        </div>
        {showColors && (
          <div className="flex flex-wrap gap-1.5 pl-8">
            {PRESET_COLORS.map((c) => (
              <button
                key={c}
                onClick={() => { setColor(c); setShowColors(false); }}
                className={cn(
                  "size-6 rounded-md border-2 transition-all hover:scale-110",
                  color === c ? "border-slate-700 ring-1 ring-slate-400" : "border-transparent"
                )}
                style={{ backgroundColor: c }}
              />
            ))}
            <div className="ml-1 flex items-center gap-1">
              <Palette className="size-3 text-slate-400" />
              <input
                type="color"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                className="size-6 cursor-pointer rounded border-0 p-0"
              />
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="group flex items-center gap-3 rounded-lg border border-slate-100 bg-white px-3 py-2.5 transition-colors hover:border-slate-200">
      <div className="size-4 shrink-0 rounded-md" style={{ backgroundColor: rt.color }} />
      <span className="flex-1 text-sm font-medium text-slate-700">{rt.name}</span>
      <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
        <button
          onClick={() => setEditing(true)}
          className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
        >
          <Pencil className="size-3.5" />
        </button>
        {!rt.is_system && (
          <button
            onClick={() => onDelete(rt.id)}
            className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-500"
          >
            <Trash2 className="size-3.5" />
          </button>
        )}
      </div>
      {!!rt.is_system && (
        <span className="text-[10px] text-slate-400 shrink-0">системный</span>
      )}
    </div>
  );
}

function normalizeMappings(defaults: typeof KAITEN_DEFAULT_FIELD_MAPPINGS, mappings: SyncFieldMapping[]) {
  return defaults.map((defaultMapping) => {
    const existing = mappings.find((mapping) => mapping.local_field === defaultMapping.local_field);
    return {
      local_field: defaultMapping.local_field,
      remote_field: existing?.remote_field ?? defaultMapping.remote_field,
    };
  });
}

function SelectionGroup({
  title,
  items,
  selected,
  onToggle,
  onSelectAll,
  onClear,
  emptyText,
}: {
  title: string;
  items: Array<{ id: string; title: string }>;
  selected: string[];
  onToggle: (value: string) => void;
  onSelectAll: () => void;
  onClear: () => void;
  emptyText: string;
}) {
  const allSelected = items.length > 0 && selected.length === items.length;

  return (
    <div className="rounded-xl border border-slate-200/80 bg-white/90 p-3 shadow-sm">
      <div className="mb-2 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-slate-900">{title}</span>
          <span className="text-xs text-slate-400">
            {selected.length > 0 ? `${selected.length} выбр.` : "все"}
          </span>
        </div>
        {items.length > 0 && (
          <button
            type="button"
            onClick={allSelected ? onClear : onSelectAll}
            className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-medium text-slate-600 transition-colors hover:border-slate-300 hover:bg-slate-100"
          >
            {allSelected ? "Сбросить" : "Все"}
          </button>
        )}
      </div>
      <div className="h-px bg-slate-100" />
      {items.length === 0 ? (
        <p className="mt-2 text-xs text-slate-400">{emptyText}</p>
      ) : (
        <div className="mt-2 max-h-44 space-y-1 overflow-auto pr-1">
          {items.map((item) => {
            const isSelected = selected.includes(item.id);

            return (
              <label
                key={item.id}
                className={cn(
                  "flex cursor-pointer items-center gap-2 rounded-lg border px-2 py-1.5 text-sm transition-colors",
                  isSelected
                    ? "border-sky-200 bg-sky-50 text-slate-900"
                    : "border-transparent text-slate-700 hover:border-slate-200 hover:bg-slate-50"
                )}
              >
                <Checkbox checked={isSelected} onCheckedChange={() => onToggle(item.id)} />
                <span className="truncate">{item.title}</span>
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function SettingsView() {
  const relationTypes = useBrainStore((s) => s.relationTypes);
  const fetchRelationTypes = useBrainStore((s) => s.fetchRelationTypes);
  const createRelationType = useBrainStore((s) => s.createRelationType);
  const updateRelationType = useBrainStore((s) => s.updateRelationType);
  const deleteRelationType = useBrainStore((s) => s.deleteRelationType);
  const fetchStagingItems = useBrainStore((s) => s.fetchStagingItems);

  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState("#6b7280");
  const [showNewColors, setShowNewColors] = useState(false);
  const [categoryManagerOpen, setCategoryManagerOpen] = useState(false);

  const [settings, setSettings] = useState<IntegrationSettings>(DEFAULT_SETTINGS);
  const [tokenInput, setTokenInput] = useState("");
  const [profiles, setProfiles] = useState<KaitenProfileWithImport[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null);
  const [profileName, setProfileName] = useState("Kaiten import");
  const [importEnabled, setImportEnabled] = useState(true);
  const [sourceSpaceId, setSourceSpaceId] = useState<number | null>(null);
  const [sourceBoardId, setSourceBoardId] = useState<number | null>(null);
  const [sourceStatuses, setSourceStatuses] = useState<string[]>([]);
  const [sourceColumns, setSourceColumns] = useState<string[]>([]);
  const [sourceLanes, setSourceLanes] = useState<string[]>([]);
  const [spaces, setSpaces] = useState<KaitenSpace[]>([]);
  const [boards, setBoards] = useState<KaitenBoardOption[]>([]);
  const [fieldMappings, setFieldMappings] = useState<Array<{ local_field: string; remote_field: string }>>(
    KAITEN_DEFAULT_FIELD_MAPPINGS.map((mapping) => ({ ...mapping }))
  );
  const [lastImport, setLastImport] = useState<KaitenImportResult | null>(null);
  const [kaitenLoading, setKaitenLoading] = useState(true);
  const [boardsLoading, setBoardsLoading] = useState(false);
  const [saveLoading, setSaveLoading] = useState(false);
  const [testLoading, setTestLoading] = useState(false);
  const [importLoading, setImportLoading] = useState(false);
  const [banner, setBanner] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  const selectedBoard = useMemo(
    () => boards.find((board) => board.id === sourceBoardId) ?? null,
    [boards, sourceBoardId]
  );
  const selectedSpace = useMemo(
    () => spaces.find((space) => space.id === sourceSpaceId) ?? null,
    [spaces, sourceSpaceId]
  );

  const applyProfile = useCallback((profile: KaitenProfileWithImport | null) => {
    setSelectedProfileId(profile?.id ?? null);
    setProfileName(profile?.name ?? "Kaiten import");
    setImportEnabled(profile?.import_enabled ?? true);
    setSourceSpaceId(profile?.source_space_id ?? null);
    setSourceBoardId(profile?.source_board_id ?? null);
    setSourceStatuses(profile?.source_statuses ?? []);
    setSourceColumns(profile?.source_columns ?? []);
    setSourceLanes(profile?.source_lanes ?? []);
    setLastImport(profile?.last_import ?? null);
  }, []);

  const fetchJson = useCallback(async <T,>(url: string, init?: RequestInit): Promise<T> => {
    const response = await fetch(url, init);
    const raw = await response.text();
    if (!raw.trim()) {
      throw new Error(`Сервер вернул пустой ответ для ${url}`);
    }

    let payload: unknown;
    try {
      payload = JSON.parse(raw);
    } catch {
      throw new Error(`Сервер вернул некорректный ответ для ${url}`);
    }

    if (!response.ok) {
      const message =
        payload && typeof payload === "object" && "error" in payload
          ? String((payload as { error?: unknown }).error ?? "Request failed")
          : "Request failed";
      throw new Error(message);
    }
    return payload as T;
  }, []);

  const loadBoards = useCallback(async ({
    settingsValue,
    spaceIdValue,
  }: {
    settingsValue: IntegrationSettings;
    spaceIdValue: number | null;
  }) => {
    if (!settingsValue.company_domain || !settingsValue.has_token) {
      setSpaces([]);
      setBoards([]);
      return;
    }

    setBoardsLoading(true);
    try {
      const query = spaceIdValue ? `?space_id=${spaceIdValue}` : "";
      const payload = await fetchJson<BoardsResponse>(`/api/kaiten/boards${query}`);
      setSpaces(payload.spaces ?? []);
      setBoards(payload.boards ?? []);
      if (!spaceIdValue && payload.selected_space_id) {
        setSourceSpaceId(payload.selected_space_id);
      }
    } catch (error) {
      setBanner({
        tone: "error",
        text: error instanceof Error ? error.message : "Не удалось загрузить пространства и доски Kaiten",
      });
    } finally {
      setBoardsLoading(false);
    }
  }, [fetchJson]);

  const loadFieldMappings = useCallback(async (profileId: string | null) => {
    const query = profileId ? `?profile_id=${profileId}` : "";
    const payload = await fetchJson<FieldMappingsResponse>(`/api/kaiten/field-mappings${query}`);
    setFieldMappings(normalizeMappings(payload.defaults, payload.mappings));
  }, [fetchJson]);

  const loadKaitenState = useCallback(async () => {
    setKaitenLoading(true);
    try {
      const [settingsPayload, profilesPayload] = await Promise.all([
        fetchJson<IntegrationSettings>("/api/kaiten/settings"),
        fetchJson<KaitenProfileWithImport[]>("/api/kaiten/profiles"),
      ]);

      setSettings(settingsPayload);
      setTokenInput("");
      setProfiles(profilesPayload);

      const activeProfile = profilesPayload[0] ?? null;
      applyProfile(activeProfile);
      setKaitenLoading(false);

      void loadFieldMappings(activeProfile?.id ?? null);

      if (settingsPayload.company_domain && settingsPayload.has_token) {
        void loadBoards({
          settingsValue: settingsPayload,
          spaceIdValue: activeProfile?.source_space_id ?? null,
        });
      } else {
        setSpaces([]);
        setBoards([]);
      }
    } catch (error) {
      setBanner({
        tone: "error",
        text: error instanceof Error ? error.message : "Не удалось загрузить настройки Kaiten",
      });
      setKaitenLoading(false);
    }
  }, [applyProfile, fetchJson, loadBoards, loadFieldMappings]);

  useEffect(() => {
    fetchRelationTypes();
    loadKaitenState();
  }, [fetchRelationTypes, loadKaitenState]);

  useEffect(() => {
    if (!selectedBoard) return;
    setSourceStatuses((current) => current.filter((value) => selectedBoard.statuses.includes(value)));
    setSourceColumns((current) => current.filter((value) => selectedBoard.columns.some((column) => column.id === value)));
    setSourceLanes((current) => current.filter((value) => selectedBoard.lanes.some((lane) => lane.id === value)));
  }, [selectedBoard]);

  const isConnectionConfigured = Boolean(settings.company_domain && settings.has_token);
  const canImport = Boolean(selectedProfileId && sourceBoardId && isConnectionConfigured);
  const importChangesCount = lastImport ? lastImport.created + lastImport.updated : 0;
  const importSummary = lastImport
    ? `${lastImport.created} создано, ${lastImport.updated} обновлено`
    : "Импорт ещё не запускался";
  const connectionStatusLabel = !settings.enabled
    ? "Выключена"
    : isConnectionConfigured
      ? "Готово"
      : "Настройте";
  const connectionStatusTone = !settings.enabled ? "slate" : isConnectionConfigured ? "emerald" : "amber";

  const handleCreate = useCallback(async () => {
    if (!newName.trim()) return;
    await createRelationType(newName.trim(), newColor);
    setNewName("");
    setNewColor("#6b7280");
    setShowAdd(false);
    setShowNewColors(false);
  }, [newName, newColor, createRelationType]);

  const toggleSelection = (value: string, selected: string[], setter: (values: string[]) => void) => {
    setter(selected.includes(value) ? selected.filter((item) => item !== value) : [...selected, value]);
  };

  const handleProfileSelect = async (profileId: string | null) => {
    if (!profileId) return;
    const profile = profiles.find((entry) => entry.id === profileId) ?? null;
    applyProfile(profile);
    const tasks = [loadFieldMappings(profile?.id ?? null)];
    if (profile?.source_space_id) {
      tasks.push(loadBoards({
        settingsValue: settings,
        spaceIdValue: profile.source_space_id,
      }));
    } else {
      setBoards([]);
    }
    await Promise.all(tasks);
  };

  const persistSettingsOnly = async () => {
    const savedSettings = await fetchJson<IntegrationSettings>("/api/kaiten/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        enabled: settings.enabled,
        company_domain: settings.company_domain,
        token: tokenInput || undefined,
      }),
    });
    setSettings(savedSettings);
    setTokenInput("");
    return savedSettings;
  };

  const handleSaveSync = async () => {
    setSaveLoading(true);
    setBanner(null);

    try {
      const savedSettings = await persistSettingsOnly();
      const savedProfile = await fetchJson<KaitenProfileWithImport>("/api/kaiten/profiles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: selectedProfileId,
          name: profileName.trim() || "Kaiten import",
          source_space_id: sourceSpaceId,
          source_board_id: sourceBoardId,
          import_enabled: importEnabled,
          export_enabled: true,
          sync_interval_minutes: 60,
          remote_wins_on_conflict: true,
          source_statuses: sourceStatuses,
          source_columns: sourceColumns,
          source_lanes: sourceLanes,
        }),
      });

      const mappingsPayload = await fetchJson<FieldMappingsResponse>("/api/kaiten/field-mappings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          profile_id: savedProfile.id,
          mappings: fieldMappings.map((mapping) => ({
            local_field: mapping.local_field,
            remote_field: mapping.remote_field,
            direction: "import",
          })),
        }),
      });

      const refreshedProfiles = await fetchJson<KaitenProfileWithImport[]>("/api/kaiten/profiles");
      setProfiles(refreshedProfiles);
      const nextProfile = refreshedProfiles.find((profile) => profile.id === savedProfile.id) ?? savedProfile;
      applyProfile(nextProfile);
      setFieldMappings(normalizeMappings(mappingsPayload.defaults, mappingsPayload.mappings));

      if (savedSettings.company_domain && savedSettings.has_token) {
        await loadBoards({
          settingsValue: savedSettings,
          spaceIdValue: sourceSpaceId,
        });
      }

      setBanner({ tone: "success", text: "Настройки синхронизации Kaiten сохранены" });
    } catch (error) {
      setBanner({
        tone: "error",
        text: error instanceof Error ? error.message : "Не удалось сохранить настройки Kaiten",
      });
    } finally {
      setSaveLoading(false);
    }
  };

  const handleTestConnection = async () => {
    setTestLoading(true);
    setBanner(null);

    try {
      const savedSettings = await persistSettingsOnly();
      const payload = await fetchJson<{ ok: boolean; spaces_count: number }>("/api/kaiten/test", { method: "POST" });
      if (savedSettings.company_domain && savedSettings.has_token) {
        await loadBoards({
          settingsValue: savedSettings,
          spaceIdValue: sourceSpaceId,
        });
      }
      setBanner({
        tone: "success",
        text: `Подключение к Kaiten успешно. Найдено пространств: ${payload.spaces_count}.`,
      });
    } catch (error) {
      setBanner({
        tone: "error",
        text: error instanceof Error ? error.message : "Проверка подключения к Kaiten не удалась",
      });
    } finally {
      setTestLoading(false);
    }
  };

  const handleImport = async () => {
    if (!selectedProfileId) {
      setBanner({ tone: "error", text: "Сначала сохраните профиль синхронизации" });
      return;
    }

    setImportLoading(true);
    setBanner(null);

    try {
      const payload = await fetchJson<KaitenImportResult>("/api/kaiten/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profile_id: selectedProfileId }),
      });
      setLastImport(payload);
      await fetchStagingItems();
      setBanner({
        tone: "success",
        text: `Импорт завершен. Найдено: ${payload.found}, создано: ${payload.created}, обновлено: ${payload.updated}.`,
      });
      const refreshedProfiles = await fetchJson<KaitenProfileWithImport[]>("/api/kaiten/profiles");
      setProfiles(refreshedProfiles);
    } catch (error) {
      setBanner({
        tone: "error",
        text: error instanceof Error ? error.message : "Импорт из Kaiten завершился ошибкой",
      });
    } finally {
      setImportLoading(false);
    }
  };

  const statusDotColor = connectionStatusTone === "emerald"
    ? "bg-emerald-500"
    : connectionStatusTone === "amber"
      ? "bg-amber-500"
      : "bg-slate-400";

  return (
    <div className="flex-1 overflow-auto bg-gradient-to-b from-slate-50 to-white">
      <div className="mx-auto max-w-7xl px-4 py-4 sm:px-6 lg:px-8">

        {/* ---- Compact header ---- */}
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-xl font-semibold tracking-tight text-slate-950">Настройки</h1>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-600">
              <span className={cn("size-1.5 rounded-full", statusDotColor)} />
              {connectionStatusLabel}
            </div>
            {selectedBoard && (
              <div className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-600">
                {selectedBoard.title}
              </div>
            )}
          </div>
        </div>

        {banner && (
          <div
            className={cn(
              "mb-4 rounded-lg border px-3 py-2 text-sm",
              banner.tone === "success"
                ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                : "border-red-200 bg-red-50 text-red-700"
            )}
          >
            {banner.text}
          </div>
        )}

        {/* ---- Kaiten Sync section ---- */}
        <div className="mb-6 rounded-2xl border border-slate-200/80 bg-white/80 p-4 shadow-sm backdrop-blur">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <div className="rounded-lg border border-sky-200 bg-sky-50 p-1.5">
                <PlugZap className="size-4 text-sky-600" />
              </div>
              <h2 className="text-base font-semibold tracking-tight text-slate-900">Kaiten Sync</h2>
            </div>
            <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-0.5 text-[11px] text-slate-500">
              staging + sync
            </span>
          </div>

          {kaitenLoading ? (
            <div className="flex items-center justify-center py-8">
              <div className="flex items-center gap-2 text-sm text-slate-500">
                <Loader2 className="size-4 animate-spin" />
                Загрузка настроек Kaiten...
              </div>
            </div>
          ) : (
          <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
            <div className="space-y-4">
              {/* Connection card */}
              <div
                className="rounded-xl border border-slate-200/80 bg-white p-4 shadow-sm"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    handleSaveSync();
                  }
                }}
              >
                <div className="mb-3 flex items-center gap-2">
                  <Settings2 className="size-4 text-slate-500" />
                  <span className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-500">Подключение</span>
                </div>

                <div className="space-y-3">
                  <label className="flex items-center gap-3 rounded-lg border border-slate-200 bg-slate-50/80 px-3 py-2 text-sm text-slate-700">
                    <Checkbox
                      checked={settings.enabled}
                      onCheckedChange={() => setSettings((current) => ({ ...current, enabled: !current.enabled }))}
                    />
                    <span className="font-medium text-slate-900">Включить интеграцию Kaiten</span>
                  </label>

                  <div className="grid gap-3 md:grid-cols-2">
                    <div className="space-y-1">
                      <label className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                        Company domain
                      </label>
                      <Input
                        value={settings.company_domain}
                        onChange={(e) => setSettings((current) => ({ ...current, company_domain: e.target.value.trim() }))}
                        placeholder="my-company"
                        className="h-9 rounded-lg border-slate-200 bg-slate-50/60 px-3"
                      />
                    </div>

                    <div className="space-y-1">
                      <label className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                        API token
                      </label>
                      <Input
                        type="password"
                        value={tokenInput}
                        onChange={(e) => setTokenInput(e.target.value)}
                        placeholder={settings.has_token ? settings.token_masked ?? "Token saved" : "Paste Kaiten token"}
                        className="h-9 rounded-lg border-slate-200 bg-slate-50/60 px-3"
                      />
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <Button onClick={handleTestConnection} disabled={testLoading || saveLoading} size="sm" className="rounded-lg px-3">
                      {testLoading ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
                      Проверить
                    </Button>
                    <Button variant="outline" onClick={handleSaveSync} disabled={saveLoading} size="sm" className="rounded-lg px-3">
                      {saveLoading ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
                      Сохранить
                    </Button>
                  </div>
                </div>
              </div>

              {/* Import profile card */}
              <div className="rounded-xl border border-slate-200/80 bg-white p-4 shadow-sm">
                <div className="mb-3 flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
                  <h3 className="text-sm font-semibold text-slate-900">Профиль импорта</h3>
                  <div className="flex flex-wrap gap-2">
                    {profiles.length > 0 && (
                      <Select value={selectedProfileId ?? profiles[0]?.id} onValueChange={handleProfileSelect}>
                        <SelectTrigger className="h-9 min-w-[200px] rounded-lg border-slate-200 bg-white px-3 text-sm">
                          <span className="flex flex-1 text-left">
                            {profiles.find((profile) => profile.id === (selectedProfileId ?? profiles[0]?.id))?.name ?? "Выберите профиль"}
                          </span>
                        </SelectTrigger>
                        <SelectContent className="border-slate-200 bg-white">
                          {profiles.map((profile) => (
                            <SelectItem key={profile.id} value={profile.id}>
                              {profile.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-9 rounded-lg border-slate-200 px-3 text-sm"
                      onClick={() =>
                        loadBoards({
                          settingsValue: settings,
                          spaceIdValue: sourceSpaceId,
                        })
                      }
                      disabled={boardsLoading || !isConnectionConfigured}
                    >
                      {boardsLoading ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
                      Обновить
                    </Button>
                  </div>
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  <div className="space-y-1">
                    <label className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Profile name</label>
                    <Input
                      value={profileName}
                      onChange={(e) => setProfileName(e.target.value)}
                      placeholder="Kaiten import"
                      className="h-9 rounded-lg border-slate-200 bg-slate-50/60 px-3"
                    />
                  </div>

                  <label className="flex items-center gap-3 rounded-lg border border-slate-200 bg-slate-50/80 px-3 py-2 text-sm text-slate-700">
                    <Checkbox checked={importEnabled} onCheckedChange={() => setImportEnabled((value) => !value)} />
                    <span className="font-medium text-slate-900">Импорт включён</span>
                  </label>
                </div>

                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  <div className="space-y-1">
                    <label className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Space</label>
                    <Select
                      value={sourceSpaceId ? String(sourceSpaceId) : "__none__"}
                      onValueChange={async (value) => {
                        const nextSpaceId = value === "__none__" ? null : Number(value);
                        setSourceSpaceId(nextSpaceId);
                        setSourceBoardId(null);
                        setSourceStatuses([]);
                        setSourceColumns([]);
                        setSourceLanes([]);
                        if (nextSpaceId) {
                          await loadBoards({
                            settingsValue: settings,
                            spaceIdValue: nextSpaceId,
                          });
                        } else {
                          setBoards([]);
                        }
                      }}
                    >
                      <SelectTrigger className="h-9 w-full rounded-lg border-slate-200 bg-slate-50/60 px-3 text-sm">
                        <span className={cn("flex flex-1 text-left", !selectedSpace && "text-muted-foreground")}>
                          {selectedSpace?.title ?? "Select space"}
                        </span>
                      </SelectTrigger>
                      <SelectContent className="border-slate-200 bg-white">
                        <SelectItem value="__none__">Не выбрано</SelectItem>
                        {spaces.map((space) => (
                          <SelectItem key={space.id} value={String(space.id)}>
                            {space.title}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Board</label>
                    <Select
                      value={sourceBoardId ? String(sourceBoardId) : "__none__"}
                      onValueChange={(value) => {
                        const nextBoardId = value === "__none__" ? null : Number(value);
                        setSourceBoardId(nextBoardId);
                        setSourceStatuses([]);
                        setSourceColumns([]);
                        setSourceLanes([]);
                      }}
                    >
                      <SelectTrigger className="h-9 w-full rounded-lg border-slate-200 bg-slate-50/60 px-3 text-sm">
                        <span className={cn("flex flex-1 text-left", !selectedBoard && "text-muted-foreground")}>
                          {selectedBoard?.title ?? "Select board"}
                        </span>
                      </SelectTrigger>
                      <SelectContent className="border-slate-200 bg-white">
                        <SelectItem value="__none__">Не выбрано</SelectItem>
                        {boards.map((board) => (
                          <SelectItem key={board.id} value={String(board.id)}>
                            {board.title}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {boardsLoading && (
                  <div className="mt-2 inline-flex items-center gap-2 text-xs text-slate-500">
                    <Loader2 className="size-3 animate-spin" />
                    Загружаем структуру доски...
                  </div>
                )}

                <div className="mt-3 grid gap-3 xl:grid-cols-3">
                  <SelectionGroup
                    title="Статусы"
                    items={(selectedBoard?.statuses ?? []).map((status) => ({ id: status, title: status }))}
                    selected={sourceStatuses}
                    onToggle={(value) => toggleSelection(value, sourceStatuses, setSourceStatuses)}
                    onSelectAll={() => setSourceStatuses(selectedBoard?.statuses ?? [])}
                    onClear={() => setSourceStatuses([])}
                    emptyText={boardsLoading ? "Загружаем..." : "Нет статусов"}
                  />
                  <SelectionGroup
                    title="Колонки"
                    items={selectedBoard?.columns ?? []}
                    selected={sourceColumns}
                    onToggle={(value) => toggleSelection(value, sourceColumns, setSourceColumns)}
                    onSelectAll={() => setSourceColumns((selectedBoard?.columns ?? []).map((column) => column.id))}
                    onClear={() => setSourceColumns([])}
                    emptyText={boardsLoading ? "Загружаем..." : "Нет колонок"}
                  />
                  <SelectionGroup
                    title="Лейны"
                    items={selectedBoard?.lanes ?? []}
                    selected={sourceLanes}
                    onToggle={(value) => toggleSelection(value, sourceLanes, setSourceLanes)}
                    onSelectAll={() => setSourceLanes((selectedBoard?.lanes ?? []).map((lane) => lane.id))}
                    onClear={() => setSourceLanes([])}
                    emptyText={boardsLoading ? "Загружаем..." : "Нет лейнов"}
                  />
                </div>
              </div>

              {/* Field mappings card */}
              <div className="rounded-xl border border-slate-200/80 bg-white p-4 shadow-sm">
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-slate-900">Маппинг полей</h3>
                  <span className="text-xs text-slate-400">{fieldMappings.length} полей</span>
                </div>

                <div className="divide-y divide-slate-100">
                  {fieldMappings.map((mapping) => (
                    <div key={mapping.local_field} className="flex items-center gap-3 py-2">
                      <span className="w-40 text-sm font-medium text-slate-600">{mapping.local_field}</span>
                      <span className="text-slate-300">&rarr;</span>
                      <Input
                        value={mapping.remote_field}
                        onChange={(e) => {
                          const nextValue = e.target.value;
                          setFieldMappings((current) =>
                            current.map((item) =>
                              item.local_field === mapping.local_field
                                ? { ...item, remote_field: nextValue }
                                : item
                            )
                          );
                        }}
                        className="h-8 flex-1 rounded-lg text-sm"
                      />
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Right sidebar: import panel (merged into one card) */}
            <div className="xl:sticky xl:top-4 xl:self-start">
              <div className="rounded-xl border border-slate-900/80 bg-gradient-to-b from-slate-900 to-slate-950 p-4 text-white shadow-lg">
                <div className="mb-3 flex items-center gap-2">
                  <Download className="size-4 text-sky-300" />
                  <h3 className="text-sm font-semibold text-sky-100/90">Ручной импорт</h3>
                </div>

                <Button
                  className="h-9 w-full rounded-lg bg-sky-500 text-sm text-white hover:bg-sky-400 disabled:bg-slate-700"
                  onClick={handleImport}
                  disabled={importLoading || !canImport}
                >
                  {importLoading ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
                  Запустить импорт
                </Button>

                <Separator className="my-3 bg-white/10" />

                <div className="text-xs text-slate-300">
                  <div className="mb-1.5 font-medium text-slate-200">Последний запуск</div>
                  {lastImport ? (
                    <div className="space-y-1.5">
                      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                        <div className="flex justify-between">
                          <span className="text-slate-400">Found</span>
                          <span className="font-medium text-white">{lastImport.found}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-400">Created</span>
                          <span className="font-medium text-white">{lastImport.created}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-400">Updated</span>
                          <span className="font-medium text-white">{lastImport.updated}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-400">Errors</span>
                          <span className={cn("font-medium", lastImport.errors > 0 ? "text-red-400" : "text-white")}>{lastImport.errors}</span>
                        </div>
                      </div>
                      <div className="flex justify-between text-[11px]">
                        <span className="text-slate-500">Skipped: {lastImport.skipped}</span>
                        <span className="text-slate-500">IDs: {lastImport.imported_ids.length}</span>
                      </div>
                      {lastImport.errors_detail.length > 0 && (
                        <div className="mt-1.5 rounded-lg border border-red-500/30 bg-red-500/10 px-2.5 py-1.5 text-[11px] leading-4 text-red-300">
                          {lastImport.errors_detail.join(" | ")}
                        </div>
                      )}
                    </div>
                  ) : (
                    <p className="text-slate-500">Импорт еще не запускался.</p>
                  )}
                </div>
              </div>
            </div>
          </div>
          )}
        </div>

        {/* ---- Bottom reference sections ---- */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {/* Categories */}
          <section className="rounded-xl border border-slate-200/80 bg-white p-3.5 shadow-sm">
            <div className="mb-2 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <FolderKanban className="size-4 text-sky-600" />
                <span className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-500">Категории</span>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="h-7 rounded-lg border-slate-200 px-3 text-xs"
                onClick={() => setCategoryManagerOpen(true)}
              >
                Управлять
              </Button>
            </div>
            <CategoryManager open={categoryManagerOpen} onOpenChange={setCategoryManagerOpen} />
          </section>

          {/* CRM Systems */}
          <section className="rounded-xl border border-slate-200/80 bg-white p-3.5 shadow-sm">
            <CrmSystemsSection />
          </section>

          {/* Tags */}
          <TagsSection />

          {/* Task statuses */}
          <TaskStatusesSection />

          {/* Development Stages */}
          <DevelopmentStagesSection />

          {/* Participants */}
          <DevelopmentParticipantsSection />

          {/* Users */}
          <section className="rounded-xl border border-slate-200/80 bg-white p-3.5 shadow-sm">
            <UserManager />
          </section>

          {/* Notifications */}
          <NotificationsSettings />

          {/* Time tracking */}
          <TimingSettingsCard />

          {/* Relation Types */}
          <section className="rounded-xl border border-slate-200/80 bg-white p-3.5 shadow-sm">
            <div className="mb-2 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Link className="size-4 text-sky-600" />
                <span className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-500">Типы связей</span>
                {relationTypes.length > 0 && (
                  <span className="text-xs text-slate-400">({relationTypes.length})</span>
                )}
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowAdd(!showAdd)}
                className="h-7 gap-1 rounded-lg border-slate-200 px-2.5 text-xs"
              >
                <Plus className="size-3.5" />
                Добавить
              </Button>
            </div>

            {showAdd && (
              <div className="mb-3 space-y-2 rounded-lg border border-violet-200 bg-violet-50/30 p-2.5">
                <div className="flex items-center gap-2">
                  <div
                    className="size-6 shrink-0 cursor-pointer rounded-md border border-slate-200"
                    style={{ backgroundColor: newColor }}
                    onClick={() => setShowNewColors(!showNewColors)}
                  />
                  <Input
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder="Название нового типа..."
                    className="h-8 flex-1 rounded-lg bg-white text-sm"
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleCreate();
                      if (e.key === "Escape") { setShowAdd(false); setShowNewColors(false); }
                    }}
                  />
                  <Button size="sm" onClick={handleCreate} disabled={!newName.trim()} className="h-8 px-2.5 text-xs">
                    <Check className="mr-1 size-3.5" /> Создать
                  </Button>
                  <Button variant="ghost" size="icon-xs" onClick={() => { setShowAdd(false); setShowNewColors(false); }} className="text-slate-400">
                    <X className="size-3.5" />
                  </Button>
                </div>
                {showNewColors && (
                  <div className="flex flex-wrap gap-1.5 pl-8">
                    {PRESET_COLORS.map((c) => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => { setNewColor(c); setShowNewColors(false); }}
                        className={cn(
                          "size-6 rounded-md border-2 transition-all hover:scale-110",
                          newColor === c ? "border-slate-700 ring-1 ring-slate-400" : "border-transparent"
                        )}
                        style={{ backgroundColor: c }}
                      />
                    ))}
                    <div className="ml-1 flex items-center gap-1">
                      <Palette className="size-3 text-slate-400" />
                      <input
                        type="color"
                        value={newColor}
                        onChange={(e) => setNewColor(e.target.value)}
                        className="size-6 cursor-pointer rounded border-0 p-0"
                      />
                    </div>
                  </div>
                )}
              </div>
            )}

            {relationTypes.length === 0 && !showAdd ? (
              <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50/70 px-4 py-4 text-center">
                <Link className="mx-auto mb-1 size-6 text-slate-300" />
                <p className="text-xs text-slate-500">Типы связей пока не созданы</p>
              </div>
            ) : (
              <div className="space-y-1">
                {relationTypes.map((rt) => (
                  <RelationTypeRow
                    key={rt.id}
                    rt={rt}
                    onUpdate={updateRelationType}
                    onDelete={deleteRelationType}
                  />
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
