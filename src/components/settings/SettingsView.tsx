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
import { Tag } from "lucide-react";

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
    <section className="rounded-[24px] border border-slate-200/80 bg-white p-5 shadow-sm">
      <div className="mb-3 flex items-center gap-2">
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
      <div className="mb-4 flex items-center gap-2">
        <Database className="size-5 text-violet-500" />
        <h2 className="text-base font-semibold text-slate-800">CRM-системы</h2>
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
        <button
          onClick={() => onDelete(rt.id)}
          className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-500"
        >
          <Trash2 className="size-3.5" />
        </button>
      </div>
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
    <div className="rounded-2xl border border-slate-200/80 bg-white/90 p-3 shadow-sm">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <span className="text-sm font-semibold text-slate-900">{title}</span>
          <p className="mt-1 text-xs text-slate-500">
            {selected.length > 0 ? `Выбрано: ${selected.length}` : "Без ограничений"}
          </p>
        </div>
        {items.length > 0 && (
          <button
            type="button"
            onClick={allSelected ? onClear : onSelectAll}
            className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-medium text-slate-600 transition-colors hover:border-slate-300 hover:bg-slate-100"
          >
            {allSelected ? "Сбросить" : "Выбрать всё"}
          </button>
        )}
      </div>
      <div className="mb-3 h-px bg-slate-100" />
      {items.length === 0 ? (
        <p className="text-xs text-slate-400">{emptyText}</p>
      ) : (
        <div className="max-h-52 space-y-2 overflow-auto pr-1">
          {items.map((item) => {
            const isSelected = selected.includes(item.id);

            return (
              <label
                key={item.id}
                className={cn(
                  "flex cursor-pointer items-center gap-2 rounded-xl border px-2.5 py-2 text-sm transition-colors",
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

function OverviewMetric({
  icon: Icon,
  label,
  value,
  hint,
  tone = "slate",
}: {
  icon: typeof PlugZap;
  label: string;
  value: string;
  hint: string;
  tone?: "sky" | "emerald" | "amber" | "slate";
}) {
  const toneStyles = {
    sky: "border-sky-200/70 bg-sky-50/80 text-sky-950",
    emerald: "border-emerald-200/70 bg-emerald-50/80 text-emerald-950",
    amber: "border-amber-200/80 bg-amber-50/90 text-amber-950",
    slate: "border-slate-200/80 bg-white/80 text-slate-950",
  } as const;

  return (
    <div className={cn("rounded-2xl border p-4 shadow-sm backdrop-blur-sm", toneStyles[tone])}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
            {label}
          </div>
          <div className="mt-2 text-base font-semibold tracking-tight text-slate-900">{value}</div>
          <div className="mt-1 text-xs leading-relaxed text-slate-500">{hint}</div>
        </div>
        <div className="rounded-2xl border border-white/70 bg-white/80 p-2 shadow-sm">
          <Icon className="size-4 text-slate-700" />
        </div>
      </div>
    </div>
  );
}

function SummaryRow({
  label,
  value,
  muted = false,
}: {
  label: string;
  value: string;
  muted?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-4 text-sm">
      <span className={cn("text-slate-500", muted && "text-slate-400")}>{label}</span>
      <span className={cn("text-right font-medium", muted ? "text-slate-500" : "text-slate-900")}>{value}</span>
    </div>
  );
}

function InlineStat({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-2xl border border-slate-200/80 bg-slate-50/80 px-4 py-3">
      <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">{label}</div>
      <div className="mt-2 text-base font-semibold text-slate-900">{value}</div>
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
  const [loading, setLoading] = useState(true);
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
    setLoading(true);
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
      setLoading(false);

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
      setLoading(false);
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
  const activeFilterCount = sourceStatuses.length + sourceColumns.length + sourceLanes.length;
  const importChangesCount = lastImport ? lastImport.created + lastImport.updated : 0;
  const importSummary = lastImport
    ? `${lastImport.created} создано, ${lastImport.updated} обновлено`
    : "Импорт ещё не запускался";
  const connectionStatusLabel = !settings.enabled
    ? "Интеграция выключена"
    : isConnectionConfigured
      ? "Подключение готово"
      : "Нужно завершить настройку";
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

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center bg-[radial-gradient(circle_at_top,rgba(14,165,233,0.08),transparent_40%)]">
        <div className="rounded-2xl border border-slate-200 bg-white/90 px-4 py-3 shadow-sm backdrop-blur">
          <div className="flex items-center gap-2 text-sm text-slate-500">
            <Loader2 className="size-4 animate-spin" />
            Загрузка настроек...
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-auto bg-[radial-gradient(circle_at_top,rgba(14,165,233,0.08),transparent_35%),linear-gradient(180deg,#f8fafc_0%,#ffffff_100%)]">
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <section className="relative overflow-hidden rounded-[32px] border border-slate-200/80 bg-white/85 shadow-[0_28px_90px_-60px_rgba(15,23,42,0.35)] backdrop-blur-sm">
          <div className="absolute inset-y-0 right-0 w-80 bg-[radial-gradient(circle_at_top,rgba(56,189,248,0.18),transparent_60%)]" />
          <div className="absolute -top-16 left-12 size-44 rounded-full bg-sky-100/70 blur-3xl" />
          <div className="relative p-6 sm:p-7">
            <div className="flex flex-col gap-6 xl:flex-row xl:items-start xl:justify-between">
              <div className="max-w-3xl">
                <div className="inline-flex items-center gap-2 rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-xs font-medium text-sky-700">
                  <PlugZap className="size-3.5" />
                  Kaiten Sync + локальные справочники
                </div>
                <h1 className="mt-4 text-3xl font-semibold tracking-tight text-slate-950 sm:text-4xl">
                  Настройки
                </h1>
                <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600 sm:text-base">
                  Соберите подключение к Kaiten, настройте профиль импорта и приведите локальные справочники
                  в порядок. Страница стала компактнее по действиям и понятнее по текущему состоянию.
                </p>
                <div className="mt-4 flex flex-wrap gap-2">
                  <div className="rounded-full border border-slate-200 bg-white/80 px-3 py-1 text-xs text-slate-600">
                    {connectionStatusLabel}
                  </div>
                  <div className="rounded-full border border-slate-200 bg-white/80 px-3 py-1 text-xs text-slate-600">
                    {selectedBoard ? `Доска: ${selectedBoard.title}` : "Доска ещё не выбрана"}
                  </div>
                  <div className="rounded-full border border-slate-200 bg-white/80 px-3 py-1 text-xs text-slate-600">
                    Ctrl/Cmd + Enter для сохранения
                  </div>
                </div>
              </div>

              <div className="grid w-full gap-3 sm:grid-cols-2 xl:w-[440px]">
                <OverviewMetric
                  icon={PlugZap}
                  label="Интеграция"
                  value={connectionStatusLabel}
                  hint={settings.company_domain ? `${settings.company_domain}.kaiten.ru` : "Добавьте домен компании"}
                  tone={connectionStatusTone}
                />
                <OverviewMetric
                  icon={Settings2}
                  label="Профиль"
                  value={profileName.trim() || "Kaiten import"}
                  hint={selectedProfileId ? "Сохранённый профиль" : "Черновик, можно сохранить"}
                  tone="slate"
                />
                <OverviewMetric
                  icon={FolderKanban}
                  label="Фильтры"
                  value={activeFilterCount > 0 ? `${activeFilterCount} активных` : "Без ограничений"}
                  hint={
                    selectedBoard
                      ? "Статусы, колонки и лейны настраиваются отдельно"
                      : "Фильтры станут доступны после выбора доски"
                  }
                  tone={activeFilterCount > 0 ? "amber" : "sky"}
                />
                <OverviewMetric
                  icon={Download}
                  label="Последний импорт"
                  value={lastImport ? `${importChangesCount} изменений` : "Не запускался"}
                  hint={importSummary}
                  tone={lastImport ? (lastImport.errors > 0 ? "amber" : "emerald") : "slate"}
                />
              </div>
            </div>

            {banner && (
              <div
                className={cn(
                  "mt-6 rounded-2xl border px-4 py-3 text-sm shadow-sm",
                  banner.tone === "success"
                    ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                    : "border-red-200 bg-red-50 text-red-700"
                )}
              >
                {banner.text}
              </div>
            )}
          </div>
        </section>

        <Separator className="my-6" />

        <div className="mb-8 rounded-[28px] border border-slate-200/80 bg-white/80 p-5 shadow-sm backdrop-blur sm:p-6">
          <div className="mb-5 flex items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="rounded-2xl border border-sky-200 bg-sky-50 p-2.5">
                <PlugZap className="size-5 text-sky-600" />
              </div>
              <div>
                <h2 className="text-lg font-semibold tracking-tight text-slate-900">Kaiten Sync</h2>
                <p className="mt-1 text-sm text-slate-500">
                  Импорт карточек в согласование и двусторонняя синхронизация изменений раз в час. При конфликте приоритет у Kaiten.
                </p>
              </div>
            </div>
            <div className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs text-slate-500">
              staging + двусторонний sync
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
            <div className="space-y-4">
              <div
                className="rounded-[24px] border border-slate-200/80 bg-white p-5 shadow-sm"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    handleSaveSync();
                  }
                }}
              >
                <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <Settings2 className="size-4 text-slate-500" />
                      <span className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-500">Подключение</span>
                    </div>
                    <p className="mt-2 text-sm leading-6 text-slate-500">
                      Базовая конфигурация интеграции. После сохранения можно сразу проверить доступ к пространствам.
                    </p>
                  </div>
                  <div className="rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-3 text-right">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Статус</div>
                    <div className="mt-1 text-sm font-semibold text-slate-900">{connectionStatusLabel}</div>
                  </div>
                </div>

                <div className="space-y-4">
                  <label className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-3 text-sm text-slate-700">
                    <Checkbox
                      checked={settings.enabled}
                      onCheckedChange={() => setSettings((current) => ({ ...current, enabled: !current.enabled }))}
                    />
                    <span className="space-y-1">
                      <span className="block font-medium text-slate-900">Включить интеграцию Kaiten</span>
                      <span className="block text-xs leading-5 text-slate-500">
                        Выключенное состояние оставляет настройки сохранёнными, но не даёт случайно запускать импорт.
                      </span>
                    </span>
                  </label>

                  <div className="grid gap-3 md:grid-cols-2">
                    <div className="space-y-1.5">
                      <label className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                        Company domain
                      </label>
                      <Input
                        value={settings.company_domain}
                        onChange={(e) => setSettings((current) => ({ ...current, company_domain: e.target.value.trim() }))}
                        placeholder="my-company"
                        className="h-11 rounded-2xl border-slate-200 bg-slate-50/60 px-4"
                      />
                      <p className="text-xs leading-5 text-slate-500">Будет использован URL вида `https://domain.kaiten.ru/api/latest`.</p>
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                        API token
                      </label>
                      <Input
                        type="password"
                        value={tokenInput}
                        onChange={(e) => setTokenInput(e.target.value)}
                        placeholder={settings.has_token ? settings.token_masked ?? "Token saved" : "Paste Kaiten token"}
                        className="h-11 rounded-2xl border-slate-200 bg-slate-50/60 px-4"
                      />
                      <p className="text-xs leading-5 text-slate-500">
                        {settings.has_token && !tokenInput ? "Токен уже сохранён. Введите новый, если нужно заменить текущий." : "Токен хранится только на сервере."}
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <Button onClick={handleTestConnection} disabled={testLoading || saveLoading} className="rounded-2xl px-4">
                      {testLoading ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
                      Проверить подключение
                    </Button>
                    <Button variant="outline" onClick={handleSaveSync} disabled={saveLoading} className="rounded-2xl px-4">
                      {saveLoading ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
                      Сохранить настройки
                    </Button>
                  </div>
                </div>
              </div>

              <div className="rounded-[24px] border border-slate-200/80 bg-white p-5 shadow-sm">
                <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <h3 className="text-base font-semibold text-slate-900">Профиль импорта</h3>
                    <p className="mt-1 text-sm leading-6 text-slate-500">Ограничение по пространству, доске и сегментам доски.</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {profiles.length > 0 && (
                      <Select value={selectedProfileId ?? profiles[0]?.id} onValueChange={handleProfileSelect}>
                        <SelectTrigger className="h-10 min-w-[220px] rounded-2xl border-slate-200 bg-white px-4 text-sm">
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
                      className="h-10 rounded-2xl border-slate-200 px-4 text-sm"
                      onClick={() =>
                        loadBoards({
                          settingsValue: settings,
                          spaceIdValue: sourceSpaceId,
                        })
                      }
                      disabled={boardsLoading || !isConnectionConfigured}
                    >
                      {boardsLoading ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
                      Обновить доски
                    </Button>
                  </div>
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Profile name</label>
                    <Input
                      value={profileName}
                      onChange={(e) => setProfileName(e.target.value)}
                      placeholder="Kaiten import"
                      className="h-11 rounded-2xl border-slate-200 bg-slate-50/60 px-4"
                    />
                  </div>

                  <label className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-3 text-sm text-slate-700">
                    <Checkbox checked={importEnabled} onCheckedChange={() => setImportEnabled((value) => !value)} />
                    <span className="space-y-1">
                      <span className="block font-medium text-slate-900">Включить импорт для этого профиля</span>
                      <span className="block text-xs leading-5 text-slate-500">
                        Профиль можно хранить, но временно выключать без удаления настроек.
                      </span>
                    </span>
                  </label>
                </div>

                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  <div className="space-y-1.5">
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
                      <SelectTrigger className="h-11 w-full rounded-2xl border-slate-200 bg-slate-50/60 px-4 text-sm">
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

                  <div className="space-y-1.5">
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
                      <SelectTrigger className="h-11 w-full rounded-2xl border-slate-200 bg-slate-50/60 px-4 text-sm">
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

                <div className="mt-4 grid gap-3 sm:grid-cols-3">
                  <InlineStat label="Статусы" value={sourceStatuses.length > 0 ? String(sourceStatuses.length) : "Все"} />
                  <InlineStat label="Колонки" value={sourceColumns.length > 0 ? String(sourceColumns.length) : "Все"} />
                  <InlineStat label="Лейны" value={sourceLanes.length > 0 ? String(sourceLanes.length) : "Все"} />
                </div>

                <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
                  <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <div className="text-sm font-semibold text-slate-900">
                        {selectedBoard ? "Тонкая настройка выборки" : "Сначала выберите доску"}
                      </div>
                      <div className="mt-1 text-xs leading-5 text-slate-500">
                        Если фильтры не заданы, импорт охватит все доступные сегменты выбранной доски.
                      </div>
                    </div>
                    {boardsLoading && (
                      <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-500">
                        <Loader2 className="size-3.5 animate-spin" />
                        Обновляем структуру доски
                      </div>
                    )}
                  </div>
                </div>

                <div className="mt-4 grid gap-3 xl:grid-cols-3">
                  <SelectionGroup
                    title="Статусы"
                    items={(selectedBoard?.statuses ?? []).map((status) => ({ id: status, title: status }))}
                    selected={sourceStatuses}
                    onToggle={(value) => toggleSelection(value, sourceStatuses, setSourceStatuses)}
                    onSelectAll={() => setSourceStatuses(selectedBoard?.statuses ?? [])}
                    onClear={() => setSourceStatuses([])}
                    emptyText={boardsLoading ? "Загружаем доски..." : "У выбранной доски пока нет доступных статусов."}
                  />
                  <SelectionGroup
                    title="Колонки"
                    items={selectedBoard?.columns ?? []}
                    selected={sourceColumns}
                    onToggle={(value) => toggleSelection(value, sourceColumns, setSourceColumns)}
                    onSelectAll={() => setSourceColumns((selectedBoard?.columns ?? []).map((column) => column.id))}
                    onClear={() => setSourceColumns([])}
                    emptyText={boardsLoading ? "Загружаем доски..." : "Колонки для этой доски не пришли из API."}
                  />
                  <SelectionGroup
                    title="Лейны"
                    items={selectedBoard?.lanes ?? []}
                    selected={sourceLanes}
                    onToggle={(value) => toggleSelection(value, sourceLanes, setSourceLanes)}
                    onSelectAll={() => setSourceLanes((selectedBoard?.lanes ?? []).map((lane) => lane.id))}
                    onClear={() => setSourceLanes([])}
                    emptyText={boardsLoading ? "Загружаем доски..." : "Лейны для этой доски не пришли из API."}
                  />
                </div>
              </div>

              <div className="rounded-[24px] border border-slate-200/80 bg-white p-5 shadow-sm">
                <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                  <div>
                    <h3 className="text-base font-semibold text-slate-900">Маппинг полей</h3>
                    <p className="mt-1 text-sm leading-6 text-slate-500">На первом этапе маппинг ограничен базовыми полями локальной модели item.</p>
                  </div>
                  <div className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-600">
                    {fieldMappings.length} полей
                  </div>
                </div>

                <div className="space-y-3">
                  {fieldMappings.map((mapping) => (
                    <div
                      key={mapping.local_field}
                      className="grid gap-3 rounded-2xl border border-slate-200/80 bg-slate-50/70 p-4 sm:grid-cols-[180px_minmax(0,1fr)] sm:items-center"
                    >
                      <div>
                        <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Local field</div>
                        <div className="mt-1 text-sm font-semibold text-slate-900">{mapping.local_field}</div>
                      </div>
                      <div className="space-y-2">
                        <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Remote field in Kaiten</div>
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
                          className="h-11 rounded-2xl border-slate-200 bg-white px-4"
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="space-y-4 xl:sticky xl:top-6 xl:self-start">
              <div className="overflow-hidden rounded-[24px] border border-slate-900/80 bg-[radial-gradient(circle_at_top_right,rgba(56,189,248,0.22),transparent_38%),linear-gradient(180deg,#0f172a_0%,#020617_100%)] p-5 text-white shadow-[0_24px_80px_-48px_rgba(2,6,23,0.95)]">
                <div className="mb-3 flex items-center gap-2">
                  <Download className="size-4 text-sky-200" />
                  <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-sky-100/80">Ручной импорт</h3>
                </div>

                <div className="space-y-3 text-sm text-slate-200">
                  <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-4">
                    <div className="font-medium text-white">Текущая конфигурация</div>
                    <div className="mt-3 space-y-2 text-xs">
                      <div className="flex items-center justify-between gap-4">
                        <span className="text-slate-400">Integration</span>
                        <span className="font-medium text-white">{settings.enabled ? "enabled" : "disabled"}</span>
                      </div>
                      <div className="flex items-center justify-between gap-4">
                        <span className="text-slate-400">Space</span>
                        <span className="text-right font-medium text-white">{selectedSpace?.title ?? "not selected"}</span>
                      </div>
                      <div className="flex items-center justify-between gap-4">
                        <span className="text-slate-400">Board</span>
                        <span className="text-right font-medium text-white">{selectedBoard?.title ?? "not selected"}</span>
                      </div>
                      <div className="flex items-center justify-between gap-4">
                        <span className="text-slate-400">Status filters</span>
                        <span className="font-medium text-white">{sourceStatuses.length ? String(sourceStatuses.length) : "all"}</span>
                      </div>
                      <div className="flex items-center justify-between gap-4">
                        <span className="text-slate-400">Column filters</span>
                        <span className="font-medium text-white">{sourceColumns.length ? String(sourceColumns.length) : "all"}</span>
                      </div>
                      <div className="flex items-center justify-between gap-4">
                        <span className="text-slate-400">Lane filters</span>
                        <span className="font-medium text-white">{sourceLanes.length ? String(sourceLanes.length) : "all"}</span>
                      </div>
                    </div>
                  </div>

                  <Button
                    className="h-11 w-full rounded-2xl bg-sky-500 text-white hover:bg-sky-400 disabled:bg-slate-700"
                    onClick={handleImport}
                    disabled={importLoading || !canImport}
                  >
                    {importLoading ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
                    Запустить импорт из Kaiten
                  </Button>

                  <p className="text-xs leading-5 text-slate-400">
                    Импорт создает или обновляет записи в `staging_items` и привязки в `external_entity_links`.
                  </p>
                </div>
              </div>

              <div className="rounded-[24px] border border-slate-200/80 bg-white p-5 shadow-sm">
                <h3 className="mb-3 text-base font-semibold text-slate-900">Последний запуск</h3>
                {lastImport ? (
                  <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-3 text-sm">
                      <InlineStat label="Found" value={String(lastImport.found)} />
                      <InlineStat label="Created" value={String(lastImport.created)} />
                      <InlineStat label="Updated" value={String(lastImport.updated)} />
                      <InlineStat label="Errors" value={String(lastImport.errors)} />
                    </div>

                    <div className="rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-4 text-xs text-slate-500">
                      <div className="space-y-2">
                        <SummaryRow label="Skipped" value={String(lastImport.skipped)} />
                        <SummaryRow label="Imported ids" value={String(lastImport.imported_ids.length)} />
                        <SummaryRow label="Batch" value={lastImport.batch_id} muted />
                      </div>
                    </div>

                    {lastImport.errors_detail.length > 0 && (
                      <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-xs leading-5 text-red-700">
                        {lastImport.errors_detail.join(" | ")}
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/70 px-4 py-6 text-sm text-slate-500">
                    Импорт еще не запускался.
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="grid gap-6 xl:grid-cols-[320px_minmax(0,1fr)]">
          <section className="rounded-[24px] border border-slate-200/80 bg-white p-5 shadow-sm">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <FolderKanban className="size-4 text-sky-600" />
                  <span className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-500">Категории</span>
                </div>
                <h2 className="mt-2 text-base font-semibold text-slate-900">Локальные справочники задач</h2>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="h-9 rounded-2xl border-slate-200 px-4 text-sm"
                onClick={() => setCategoryManagerOpen(true)}
              >
                Управлять
              </Button>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-4 text-sm leading-6 text-slate-600">
              Настройте категории для задач: названия, цвета и иконки. Это помогает быстрее считывать контекст
              в списках, на канбане и в деталке задачи.
            </div>
            <CategoryManager open={categoryManagerOpen} onOpenChange={setCategoryManagerOpen} />
          </section>

          <section className="rounded-[24px] border border-slate-200/80 bg-white p-5 shadow-sm">
            <CrmSystemsSection />
          </section>

          <TagsSection />

          <section className="rounded-[24px] border border-slate-200/80 bg-white p-5 shadow-sm">
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <Link className="size-4 text-sky-600" />
                  <span className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-500">Типы связей</span>
                  {relationTypes.length > 0 && (
                    <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] text-slate-500">
                      {relationTypes.length}
                    </span>
                  )}
                </div>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">
                  Типы связей помогают унифицировать формулировки между задачами, заметками и клиентами.
                  Например: &quot;Клиент&quot;, &quot;Блокирует&quot;, &quot;Связано с&quot;.
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowAdd(!showAdd)}
                className="h-9 gap-1.5 rounded-2xl border-slate-200 px-4 text-xs"
              >
                <Plus className="size-3.5" />
                Добавить тип
              </Button>
            </div>

            {showAdd && (
              <div className="mb-4 space-y-2 rounded-2xl border border-violet-200 bg-violet-50/30 p-3">
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
                    className="h-9 flex-1 rounded-xl bg-white text-sm"
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleCreate();
                      if (e.key === "Escape") { setShowAdd(false); setShowNewColors(false); }
                    }}
                  />
                  <Button size="sm" onClick={handleCreate} disabled={!newName.trim()} className="h-9 px-3 text-xs">
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
              <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/70 px-6 py-8 text-center">
                <Link className="mx-auto mb-2 size-8 text-slate-300" />
                <p className="mb-1 text-sm text-slate-500">Типы связей пока не созданы</p>
                <p className="text-xs text-slate-400">Создайте типы, чтобы классифицировать связи между элементами</p>
              </div>
            ) : (
              <div className="space-y-1.5">
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
