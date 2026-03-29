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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
} from "lucide-react";
import { CategoryManager } from "./CategoryManager";

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
  emptyText,
}: {
  title: string;
  items: Array<{ id: string; title: string }>;
  selected: string[];
  onToggle: (value: string) => void;
  emptyText: string;
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-medium text-slate-800">{title}</span>
        <span className="text-xs text-slate-400">{selected.length} выбрано</span>
      </div>
      {items.length === 0 ? (
        <p className="text-xs text-slate-400">{emptyText}</p>
      ) : (
        <div className="space-y-2">
          {items.map((item) => (
            <label key={item.id} className="flex cursor-pointer items-center gap-2 rounded-md px-1 py-1 text-sm text-slate-700 hover:bg-slate-50">
              <Checkbox checked={selected.includes(item.id)} onCheckedChange={() => onToggle(item.id)} />
              <span className="truncate">{item.title}</span>
            </label>
          ))}
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
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || "Request failed");
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
      <div className="flex flex-1 items-center justify-center">
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <Loader2 className="size-4 animate-spin" />
          Загрузка настроек...
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-auto">
      <div className="mx-auto max-w-5xl px-6 py-8">
        <h1 className="mb-1 text-xl font-bold text-slate-900">Настройки</h1>
        <p className="mb-6 text-sm text-slate-500">
          Локальные параметры и интеграция с Kaiten для импорта карточек в staging.
        </p>

        <Separator className="mb-6" />

        <div className="mb-8 rounded-2xl border border-slate-200 bg-slate-50/70 p-5">
          <div className="mb-4 flex items-start justify-between gap-4">
            <div className="flex items-center gap-2">
              <PlugZap className="size-5 text-sky-600" />
              <div>
                <h2 className="text-base font-semibold text-slate-900">Kaiten Sync</h2>
                <p className="mt-1 text-sm text-slate-500">
                  Импорт карточек из выбранной доски Kaiten в очередь согласования.
                </p>
              </div>
            </div>
            <div className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-500">
              target: staging
            </div>
          </div>

          {banner && (
            <div
              className={cn(
                "mb-4 rounded-lg border px-3 py-2 text-sm",
                banner.tone === "success"
                  ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                  : "border-red-200 bg-red-50 text-red-700"
              )}
            >
              {banner.text}
            </div>
          )}

          <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
            <div className="space-y-4">
              <div
                className="rounded-xl border border-slate-200 bg-white p-4"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    handleSaveSync();
                  }
                }}
              >
                <div className="mb-3 flex items-center gap-2">
                  <Settings2 className="size-4 text-slate-500" />
                  <span className="text-sm font-semibold text-slate-800">Подключение</span>
                </div>

                <div className="space-y-4">
                  <label className="flex items-center gap-2 text-sm text-slate-700">
                    <Checkbox
                      checked={settings.enabled}
                      onCheckedChange={() => setSettings((current) => ({ ...current, enabled: !current.enabled }))}
                    />
                    Включить интеграцию Kaiten
                  </label>

                  <div className="grid gap-3 md:grid-cols-2">
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium uppercase tracking-wide text-slate-500">
                        Company domain
                      </label>
                      <Input
                        value={settings.company_domain}
                        onChange={(e) => setSettings((current) => ({ ...current, company_domain: e.target.value.trim() }))}
                        placeholder="my-company"
                        className="bg-white"
                      />
                      <p className="text-xs text-slate-400">Будет использован URL вида `https://domain.kaiten.ru/api/latest`.</p>
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-xs font-medium uppercase tracking-wide text-slate-500">
                        API token
                      </label>
                      <Input
                        type="password"
                        value={tokenInput}
                        onChange={(e) => setTokenInput(e.target.value)}
                        placeholder={settings.has_token ? settings.token_masked ?? "Token saved" : "Paste Kaiten token"}
                        className="bg-white"
                      />
                      <p className="text-xs text-slate-400">
                        {settings.has_token && !tokenInput ? "Токен уже сохранен. Введите новый, если нужно заменить." : "Токен хранится только на сервере."}
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <Button onClick={handleTestConnection} disabled={testLoading || saveLoading}>
                      {testLoading ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
                      Проверить подключение
                    </Button>
                    <Button variant="outline" onClick={handleSaveSync} disabled={saveLoading}>
                      {saveLoading ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
                      Сохранить настройки
                    </Button>
                  </div>
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 bg-white p-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-800">Профиль импорта</h3>
                    <p className="mt-1 text-xs text-slate-400">Ограничение по пространству, доске и сегментам доски.</p>
                  </div>
                  {profiles.length > 0 && (
                    <Select value={selectedProfileId ?? profiles[0]?.id} onValueChange={handleProfileSelect}>
                      <SelectTrigger className="h-8 min-w-[220px] border-slate-200 bg-white text-sm">
                        <SelectValue />
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
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium uppercase tracking-wide text-slate-500">Profile name</label>
                    <Input
                      value={profileName}
                      onChange={(e) => setProfileName(e.target.value)}
                      placeholder="Kaiten import"
                      className="bg-white"
                    />
                  </div>

                  <label className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700">
                    <Checkbox checked={importEnabled} onCheckedChange={() => setImportEnabled((value) => !value)} />
                    Включить импорт для этого профиля
                  </label>
                </div>

                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium uppercase tracking-wide text-slate-500">Space</label>
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
                      <SelectTrigger className="h-8 w-full border-slate-200 bg-white text-sm">
                        <SelectValue placeholder="Select space" />
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
                    <label className="text-xs font-medium uppercase tracking-wide text-slate-500">Board</label>
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
                      <SelectTrigger className="h-8 w-full border-slate-200 bg-white text-sm">
                        <SelectValue placeholder="Select board" />
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

                <div className="mt-4 grid gap-3 xl:grid-cols-3">
                  <SelectionGroup
                    title="Статусы"
                    items={(selectedBoard?.statuses ?? []).map((status) => ({ id: status, title: status }))}
                    selected={sourceStatuses}
                    onToggle={(value) => toggleSelection(value, sourceStatuses, setSourceStatuses)}
                    emptyText={boardsLoading ? "Загружаем доски..." : "У выбранной доски пока нет доступных статусов."}
                  />
                  <SelectionGroup
                    title="Колонки"
                    items={selectedBoard?.columns ?? []}
                    selected={sourceColumns}
                    onToggle={(value) => toggleSelection(value, sourceColumns, setSourceColumns)}
                    emptyText={boardsLoading ? "Загружаем доски..." : "Колонки для этой доски не пришли из API."}
                  />
                  <SelectionGroup
                    title="Лейны"
                    items={selectedBoard?.lanes ?? []}
                    selected={sourceLanes}
                    onToggle={(value) => toggleSelection(value, sourceLanes, setSourceLanes)}
                    emptyText={boardsLoading ? "Загружаем доски..." : "Лейны для этой доски не пришли из API."}
                  />
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 bg-white p-4">
                <div className="mb-3">
                  <h3 className="text-sm font-semibold text-slate-800">Маппинг полей</h3>
                  <p className="mt-1 text-xs text-slate-400">На первом этапе маппинг ограничен базовыми полями локальной модели item.</p>
                </div>

                <div className="overflow-hidden rounded-lg border border-slate-200">
                  <div className="grid grid-cols-[160px_1fr] bg-slate-50 px-3 py-2 text-xs font-medium uppercase tracking-wide text-slate-500">
                    <div>Local field</div>
                    <div>Remote field in Kaiten</div>
                  </div>
                  <div className="divide-y divide-slate-200">
                    {fieldMappings.map((mapping) => (
                      <div key={mapping.local_field} className="grid grid-cols-[160px_1fr] items-center gap-3 px-3 py-3">
                        <div className="text-sm font-medium text-slate-700">{mapping.local_field}</div>
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
                          className="bg-white"
                        />
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            <div className="space-y-4">
              <div className="rounded-xl border border-slate-200 bg-white p-4">
                <div className="mb-3 flex items-center gap-2">
                  <Download className="size-4 text-slate-500" />
                  <h3 className="text-sm font-semibold text-slate-800">Ручной импорт</h3>
                </div>

                <div className="space-y-3 text-sm text-slate-600">
                  <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                    <div className="font-medium text-slate-700">Текущая конфигурация</div>
                    <div className="mt-2 space-y-1 text-xs text-slate-500">
                      <div>Integration: {settings.enabled ? "enabled" : "disabled"}</div>
                      <div>Space: {spaces.find((space) => space.id === sourceSpaceId)?.title ?? "not selected"}</div>
                      <div>Board: {selectedBoard?.title ?? "not selected"}</div>
                      <div>Status filters: {sourceStatuses.length || "all"}</div>
                      <div>Column filters: {sourceColumns.length || "all"}</div>
                      <div>Lane filters: {sourceLanes.length || "all"}</div>
                    </div>
                  </div>

                  <Button
                    className="w-full"
                    onClick={handleImport}
                    disabled={importLoading || !selectedProfileId || !sourceBoardId}
                  >
                    {importLoading ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
                    Запустить импорт из Kaiten
                  </Button>

                  <p className="text-xs text-slate-400">
                    Импорт создает или обновляет записи в `staging_items` и привязки в `external_entity_links`.
                  </p>
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 bg-white p-4">
                <h3 className="mb-3 text-sm font-semibold text-slate-800">Последний запуск</h3>
                {lastImport ? (
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                        <div className="text-xs text-slate-400">Found</div>
                        <div className="text-lg font-semibold text-slate-900">{lastImport.found}</div>
                      </div>
                      <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                        <div className="text-xs text-slate-400">Created</div>
                        <div className="text-lg font-semibold text-slate-900">{lastImport.created}</div>
                      </div>
                      <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                        <div className="text-xs text-slate-400">Updated</div>
                        <div className="text-lg font-semibold text-slate-900">{lastImport.updated}</div>
                      </div>
                      <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                        <div className="text-xs text-slate-400">Errors</div>
                        <div className="text-lg font-semibold text-slate-900">{lastImport.errors}</div>
                      </div>
                    </div>

                    <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500">
                      <div>Skipped: {lastImport.skipped}</div>
                      <div>Imported ids: {lastImport.imported_ids.length}</div>
                      <div>Batch: {lastImport.batch_id}</div>
                    </div>

                    {lastImport.errors_detail.length > 0 && (
                      <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                        {lastImport.errors_detail.join(" | ")}
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="text-sm text-slate-400">Импорт еще не запускался.</p>
                )}
              </div>
            </div>
          </div>
        </div>

        <div>
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <FolderKanban className="size-5 text-violet-500" />
              <h2 className="text-base font-semibold text-slate-800">Категории</h2>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="h-8 border-slate-200 text-sm text-slate-600"
              onClick={() => setCategoryManagerOpen(true)}
            >
              Управлять
            </Button>
          </div>
          <p className="text-sm text-slate-500">
            Настройте категории для задач: названия, цвета и иконки.
          </p>
          <CategoryManager open={categoryManagerOpen} onOpenChange={setCategoryManagerOpen} />
        </div>

        <div>
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Link className="size-5 text-violet-500" />
              <h2 className="text-base font-semibold text-slate-800">Типы связей</h2>
              {relationTypes.length > 0 && (
                <span className="text-xs text-slate-400">({relationTypes.length})</span>
              )}
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowAdd(!showAdd)}
              className="gap-1.5 text-xs"
            >
              <Plus className="size-3.5" />
              Добавить тип
            </Button>
          </div>

          <p className="mb-4 text-xs text-slate-400">
            Типы связей позволяют классифицировать связи между задачами, заметками и клиентами.
            Например: &quot;Клиент&quot;, &quot;Блокирует&quot;, &quot;Связано с&quot;.
          </p>

          {showAdd && (
            <div className="mb-4 space-y-2 rounded-lg border border-violet-200 bg-violet-50/30 p-3">
              <div className="flex items-center gap-2">
                <div
                  className="size-6 cursor-pointer rounded-md border border-slate-200 shrink-0"
                  style={{ backgroundColor: newColor }}
                  onClick={() => setShowNewColors(!showNewColors)}
                />
                <Input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="Название нового типа..."
                  className="h-8 flex-1 text-sm"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleCreate();
                    if (e.key === "Escape") { setShowAdd(false); setShowNewColors(false); }
                  }}
                />
                <Button size="sm" onClick={handleCreate} disabled={!newName.trim()} className="h-8 px-3 text-xs">
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

          {relationTypes.length === 0 && !showAdd && (
            <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50/50 px-6 py-8 text-center">
              <Link className="mx-auto mb-2 size-8 text-slate-300" />
              <p className="mb-1 text-sm text-slate-500">Типы связей пока не созданы</p>
              <p className="text-xs text-slate-400">Создайте типы, чтобы классифицировать связи между элементами</p>
            </div>
          )}

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
        </div>
      </div>
    </div>
  );
}
