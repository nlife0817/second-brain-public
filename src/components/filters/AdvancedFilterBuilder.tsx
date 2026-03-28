"use client";

import { useCallback } from "react";
import { useBrainStore } from "@/lib/store";
import {
  FilterGroup,
  FilterCondition,
  FilterField,
  FilterOperator,
  FilterLogic,
  STATUS_CONFIG,
  PRIORITY_CONFIG,
  CATEGORY_CONFIG,
  TYPE_CONFIG,
} from "@/types";
import { v4 as uuid } from "uuid";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { Plus, X, Layers, Power, Bookmark, Check, Save, RefreshCw } from "lucide-react";

/* -------------------------------------------------------------------------- */
/*  Constants & labels                                                         */
/* -------------------------------------------------------------------------- */

const FIELD_OPTIONS: { value: FilterField; label: string }[] = [
  { value: "status", label: "Статус" },
  { value: "priority", label: "Приоритет" },
  { value: "category", label: "Категория" },
  { value: "type", label: "Тип" },
  { value: "title", label: "Название" },
  { value: "description", label: "Описание" },
  { value: "due_date", label: "Дедлайн" },
  { value: "has_parent", label: "Тип задачи" },
];

type FieldKind = "enum" | "text" | "date";

function getFieldKind(field: FilterField): FieldKind {
  if (["status", "priority", "category", "type", "has_parent"].includes(field)) return "enum";
  if (["title", "description"].includes(field)) return "text";
  return "date";
}

const OPERATOR_OPTIONS: Record<FieldKind, { value: FilterOperator; label: string }[]> = {
  enum: [
    { value: "is", label: "равно" },
    { value: "is_not", label: "не равно" },
  ],
  text: [
    { value: "contains", label: "содержит" },
    { value: "not_contains", label: "не содержит" },
    { value: "is_empty", label: "пусто" },
    { value: "is_not_empty", label: "не пусто" },
  ],
  date: [
    { value: "before", label: "до" },
    { value: "after", label: "после" },
    { value: "is_empty", label: "пусто" },
    { value: "is_not_empty", label: "не пусто" },
  ],
};

function getEnumValues(field: FilterField): { value: string; label: string }[] {
  switch (field) {
    case "status":
      return Object.entries(STATUS_CONFIG).map(([k, v]) => ({ value: k, label: v.label }));
    case "priority":
      return Object.entries(PRIORITY_CONFIG).map(([k, v]) => ({ value: k, label: v.label }));
    case "category":
      return Object.entries(CATEGORY_CONFIG).map(([k, v]) => ({ value: k, label: v.label }));
    case "type":
      return Object.entries(TYPE_CONFIG).map(([k, v]) => ({ value: k, label: v.label }));
    case "has_parent":
      return [
        { value: "yes", label: "Дочерняя" },
        { value: "no", label: "Родительская" },
      ];
    default:
      return [];
  }
}

const LOGIC_LABELS: Record<FilterLogic, string> = {
  and: "И",
  or: "ИЛИ",
};

function needsValue(operator: FilterOperator): boolean {
  return operator !== "is_empty" && operator !== "is_not_empty";
}

function defaultOperatorForField(field: FilterField): FilterOperator {
  const kind = getFieldKind(field);
  return OPERATOR_OPTIONS[kind][0].value;
}

function defaultValueForField(field: FilterField): string {
  const kind = getFieldKind(field);
  if (kind === "enum") {
    const opts = getEnumValues(field);
    return opts.length > 0 ? opts[0].value : "";
  }
  return "";
}

/* -------------------------------------------------------------------------- */
/*  AdvancedFilterBuilder                                                      */
/* -------------------------------------------------------------------------- */

export function AdvancedFilterBuilder() {
  const groups = useBrainStore((s) => s.filters.advancedGroups);
  const useAdvanced = useBrainStore((s) => s.filters.useAdvanced);
  const setAdvancedFilters = useBrainStore((s) => s.setAdvancedFilters);
  const toggleAdvancedFilters = useBrainStore((s) => s.toggleAdvancedFilters);

  /* ---- preset store selectors ------------------------------------------- */
  const savedFilters = useBrainStore((s) => s.savedFilters);
  const activeFilterId = useBrainStore((s) => s.activeFilterId);
  const saveFilter = useBrainStore((s) => s.saveFilter);
  const loadFilter = useBrainStore((s) => s.loadFilter);
  const updateFilter = useBrainStore((s) => s.updateFilter);
  const deleteFilter = useBrainStore((s) => s.deleteFilter);
  const resetActiveFilter = useBrainStore((s) => s.resetActiveFilter);

  const activePreset = savedFilters.find((f) => f.id === activeFilterId);

  /* ---- preset handlers -------------------------------------------------- */

  const handleSavePreset = useCallback(() => {
    const name = window.prompt("Имя пресета:");
    if (name && name.trim()) {
      saveFilter(name.trim());
    }
  }, [saveFilter]);

  /* ---- group-level ops --------------------------------------------------- */

  const addGroup = useCallback(() => {
    const newGroup: FilterGroup = {
      id: uuid(),
      logic: "and",
      conditions: [
        {
          id: uuid(),
          field: "status",
          operator: "is",
          value: "in_progress",
        },
      ],
    };
    setAdvancedFilters([...groups, newGroup]);
    // Auto-enable advanced filtering when adding a group
    if (!useAdvanced) toggleAdvancedFilters(true);
  }, [groups, setAdvancedFilters, useAdvanced, toggleAdvancedFilters]);

  const removeGroup = useCallback(
    (groupId: string) => {
      const remaining = groups.filter((g) => g.id !== groupId);
      setAdvancedFilters(remaining);
      // Auto-disable advanced filtering when all groups are removed
      if (remaining.length === 0 && useAdvanced) toggleAdvancedFilters(false);
    },
    [groups, setAdvancedFilters, useAdvanced, toggleAdvancedFilters]
  );

  const toggleGroupLogic = useCallback(
    (groupId: string) => {
      setAdvancedFilters(
        groups.map((g) =>
          g.id === groupId
            ? { ...g, logic: g.logic === "and" ? "or" : "and" }
            : g
        )
      );
    },
    [groups, setAdvancedFilters]
  );

  /* ---- condition-level ops ----------------------------------------------- */

  const addCondition = useCallback(
    (groupId: string) => {
      setAdvancedFilters(
        groups.map((g) =>
          g.id === groupId
            ? {
                ...g,
                conditions: [
                  ...g.conditions,
                  {
                    id: uuid(),
                    field: "status" as FilterField,
                    operator: "is" as FilterOperator,
                    value: "in_progress",
                  },
                ],
              }
            : g
        )
      );
    },
    [groups, setAdvancedFilters]
  );

  const removeCondition = useCallback(
    (groupId: string, conditionId: string) => {
      setAdvancedFilters(
        groups.map((g) =>
          g.id === groupId
            ? { ...g, conditions: g.conditions.filter((c) => c.id !== conditionId) }
            : g
        )
      );
    },
    [groups, setAdvancedFilters]
  );

  const updateCondition = useCallback(
    (groupId: string, conditionId: string, patch: Partial<FilterCondition>) => {
      setAdvancedFilters(
        groups.map((g) =>
          g.id === groupId
            ? {
                ...g,
                conditions: g.conditions.map((c) =>
                  c.id === conditionId ? { ...c, ...patch } : c
                ),
              }
            : g
        )
      );
    },
    [groups, setAdvancedFilters]
  );

  const handleFieldChange = useCallback(
    (groupId: string, conditionId: string, newField: FilterField) => {
      const op = defaultOperatorForField(newField);
      const val = needsValue(op) ? defaultValueForField(newField) : "";
      updateCondition(groupId, conditionId, { field: newField, operator: op, value: val });
    },
    [updateCondition]
  );

  const handleOperatorChange = useCallback(
    (groupId: string, conditionId: string, newOp: FilterOperator, field: FilterField) => {
      const val = needsValue(newOp) ? defaultValueForField(field) : "";
      updateCondition(groupId, conditionId, { operator: newOp, value: val });
    },
    [updateCondition]
  );

  /* ---- render ------------------------------------------------------------ */

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      {/* Header */}
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Layers className="size-4 text-slate-500" />
          <span className="text-sm font-medium text-slate-900">
            Расширенные фильтры
          </span>
          {groups.length > 0 && (
            <Button
              variant={useAdvanced ? "secondary" : "outline"}
              size="sm"
              onClick={() => toggleAdvancedFilters()}
              className={cn(
                "text-[11px] gap-1 h-6 px-2",
                useAdvanced
                  ? "bg-blue-50 text-blue-700 border-blue-200 ring-1 ring-blue-200 hover:bg-blue-100"
                  : "text-slate-500 border-slate-200"
              )}
            >
              <Power className="size-3" />
              {useAdvanced ? "Активны" : "Выключены"}
            </Button>
          )}
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={addGroup}
          className="gap-1.5 border-slate-200 text-xs"
        >
          <Plus className="size-3.5" />
          Группа
        </Button>
      </div>

      {/* ---- Presets section ------------------------------------------------ */}
      <div className="mb-4 rounded-lg border border-slate-200 bg-slate-50 p-3">
        <div className="mb-2 flex items-center gap-1.5">
          <Bookmark className="size-3.5 text-slate-400" />
          <span className="text-xs font-medium text-slate-500">Пресеты</span>
        </div>

        {/* Preset badges row */}
        <div className="flex items-center gap-1.5 flex-wrap">
          {savedFilters.map((sf) => {
            const isActive = sf.id === activeFilterId;
            return (
              <div
                key={sf.id}
                className={cn(
                  "group relative inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium transition-colors cursor-pointer",
                  isActive
                    ? "border-blue-300 bg-blue-50 text-blue-700 ring-1 ring-blue-300"
                    : "border-slate-200 bg-white text-slate-600 hover:bg-blue-50 hover:border-blue-200 hover:text-blue-700"
                )}
              >
                <button
                  type="button"
                  onClick={() => loadFilter(sf.id)}
                  className="flex items-center gap-1"
                >
                  {isActive && <Check className="size-3 text-blue-600" />}
                  {sf.name}
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    deleteFilter(sf.id);
                  }}
                  className="ml-0.5 rounded-sm p-0.5 text-slate-400 hover:bg-red-100 hover:text-red-500 transition-colors"
                >
                  <X className="size-3" />
                </button>
              </div>
            );
          })}

          {/* Add preset button */}
          <button
            type="button"
            onClick={handleSavePreset}
            className="inline-flex items-center gap-1 rounded-md border border-dashed border-slate-300 px-2 py-1 text-[11px] font-medium text-slate-400 transition-colors hover:border-slate-400 hover:text-slate-600 hover:bg-white"
          >
            <Plus className="size-3" />
            Сохранить
          </button>
        </div>

        {/* Active preset info & actions */}
        {activePreset && (
          <div className="mt-2.5 flex items-center gap-2 border-t border-slate-200 pt-2.5">
            <span className="text-xs text-slate-500">
              Активный: <span className="font-medium text-slate-700">{activePreset.name}</span>
            </span>
            <div className="flex items-center gap-1.5 ml-auto">
              <Button
                variant="outline"
                size="sm"
                onClick={() => updateFilter(activeFilterId!)}
                className="h-6 px-2 text-[11px] gap-1 border-slate-200 text-slate-600 hover:text-blue-700 hover:border-blue-200 hover:bg-blue-50"
              >
                <Save className="size-3" />
                Обновить
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => resetActiveFilter()}
                className="h-6 px-2 text-[11px] gap-1 border-slate-200 text-slate-600 hover:text-slate-900"
              >
                <RefreshCw className="size-3" />
                Сбросить
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Empty state */}
      {groups.length === 0 && (
        <p className="py-6 text-center text-sm text-slate-400">
          Нажмите &laquo;+ Группа&raquo;, чтобы добавить фильтры
        </p>
      )}

      {/* Groups */}
      <div className="flex flex-col gap-3">
        {groups.map((group, groupIdx) => (
          <div key={group.id}>
            {/* "ИЛИ" divider between groups */}
            {groupIdx > 0 && (
              <div className="flex items-center gap-3 py-2">
                <div className="h-px flex-1 bg-slate-200" />
                <span className="text-xs font-medium text-slate-400">ИЛИ</span>
                <div className="h-px flex-1 bg-slate-200" />
              </div>
            )}

            {/* Group card */}
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              {/* Group header */}
              <div className="mb-2.5 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-slate-500">
                    Группа {groupIdx + 1}
                  </span>
                  <button
                    type="button"
                    onClick={() => toggleGroupLogic(group.id)}
                    className={cn(
                      "rounded-md border px-2 py-0.5 text-[11px] font-semibold transition-colors",
                      group.logic === "and"
                        ? "border-blue-200 bg-blue-50 text-blue-600"
                        : "border-amber-200 bg-amber-50 text-amber-600"
                    )}
                  >
                    {LOGIC_LABELS[group.logic]}
                  </button>
                </div>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  onClick={() => removeGroup(group.id)}
                  className="text-slate-400 hover:text-red-500"
                >
                  <X className="size-3.5" />
                </Button>
              </div>

              {/* Conditions */}
              <div className="flex flex-col gap-2">
                {group.conditions.map((cond) => {
                  const fieldKind = getFieldKind(cond.field);
                  const operators = OPERATOR_OPTIONS[fieldKind];
                  const showValue = needsValue(cond.operator);

                  return (
                    <div
                      key={cond.id}
                      className="flex items-center gap-2"
                    >
                      {/* Field select */}
                      <Select
                        value={cond.field}
                        onValueChange={(v) =>
                          handleFieldChange(group.id, cond.id, v as FilterField)
                        }
                      >
                        <SelectTrigger className="h-8 w-[130px] border-slate-200 bg-white text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="border-slate-200 bg-white">
                          {FIELD_OPTIONS.map((f) => (
                            <SelectItem key={f.value} value={f.value}>
                              {f.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>

                      {/* Operator select */}
                      <Select
                        value={cond.operator}
                        onValueChange={(v) =>
                          handleOperatorChange(
                            group.id,
                            cond.id,
                            v as FilterOperator,
                            cond.field
                          )
                        }
                      >
                        <SelectTrigger className="h-8 w-[120px] border-slate-200 bg-white text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="border-slate-200 bg-white">
                          {operators.map((op) => (
                            <SelectItem key={op.value} value={op.value}>
                              {op.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>

                      {/* Value input / select */}
                      {showValue && fieldKind === "enum" && (
                        <Select
                          value={cond.value}
                          onValueChange={(v) =>
                            updateCondition(group.id, cond.id, { value: v ?? "" })
                          }
                        >
                          <SelectTrigger className="h-8 min-w-[130px] flex-1 border-slate-200 bg-white text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent className="border-slate-200 bg-white">
                            {getEnumValues(cond.field).map((opt) => (
                              <SelectItem key={opt.value} value={opt.value}>
                                {opt.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}

                      {showValue && fieldKind === "text" && (
                        <Input
                          value={cond.value}
                          onChange={(e) =>
                            updateCondition(group.id, cond.id, {
                              value: e.target.value,
                            })
                          }
                          placeholder="Значение..."
                          className="h-8 min-w-[130px] flex-1 border-slate-200 bg-white text-xs placeholder:text-slate-400"
                        />
                      )}

                      {showValue && fieldKind === "date" && (
                        <Input
                          type="date"
                          value={cond.value}
                          onChange={(e) =>
                            updateCondition(group.id, cond.id, {
                              value: e.target.value,
                            })
                          }
                          className="h-8 min-w-[130px] flex-1 border-slate-200 bg-white text-xs"
                        />
                      )}

                      {/* Remove condition */}
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        onClick={() => removeCondition(group.id, cond.id)}
                        className="shrink-0 text-slate-400 hover:text-red-500"
                      >
                        <X className="size-3.5" />
                      </Button>
                    </div>
                  );
                })}
              </div>

              {/* Add condition */}
              <button
                type="button"
                onClick={() => addCondition(group.id)}
                className="mt-2 flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-slate-500 transition-colors hover:bg-white hover:text-slate-900"
              >
                <Plus className="size-3.5" />
                Условие
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
