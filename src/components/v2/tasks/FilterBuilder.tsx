"use client";

// Конструктор фильтров: группы условий, внутри группы — И/ИЛИ, между группами
// всегда И. Расчёт на привычные сценарии вроде «срочное без исполнителя»
// или «мои просроченные».

import { Plus, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useV2Store } from "@/lib/core/ui-store";
import { useViewStore } from "@/lib/core/view-store";
import {
  BASE_FILTER_FIELDS,
  ME_VALUE,
  NONE_VALUE,
  OPERATORS_BY_KIND,
  OPERATOR_LABELS,
  VALUELESS_OPERATORS,
  fieldMetaFor,
  type FilterCondition,
  type FilterField,
  type FilterGroup,
  type FilterOperator,
} from "@/lib/core/views";
import { PRIORITY_LABELS } from "@/components/v2/bits";
import { cn } from "@/lib/utils";

interface Option {
  value: string;
  label: string;
  color?: string;
}

function newId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `c${Date.now()}${Math.round(Math.random() * 1e6)}`;
}

const SELECT_CLS =
  "h-7 min-w-0 rounded-lg border border-input bg-background px-1.5 text-xs text-foreground outline-none focus-visible:border-ring";

export function FilterBuilder() {
  const { statuses, tags, members, projects, fields } = useV2Store();
  const groups = useViewStore((s) => s.groups);
  const setGroups = useViewStore((s) => s.setGroups);

  const fieldOptions: { field: FilterField; label: string }[] = [
    ...BASE_FILTER_FIELDS.map((f) => ({ field: f.field, label: f.label })),
    ...fields.map((f) => ({ field: `field:${f.id}` as FilterField, label: f.name })),
  ];

  function optionsFor(field: FilterField): Option[] {
    switch (field) {
      case "status":
        return statuses.map((s) => ({ value: s.id, label: s.name, color: s.color }));
      case "priority":
        return (Object.keys(PRIORITY_LABELS) as (keyof typeof PRIORITY_LABELS)[]).map((p) => ({
          value: p,
          label: PRIORITY_LABELS[p].label,
        }));
      case "project":
        return [
          { value: NONE_VALUE, label: "Без проекта (личная)" },
          ...projects.map((p) => ({ value: p.id, label: p.name, color: p.color })),
        ];
      case "assignee":
        return [
          { value: ME_VALUE, label: "Я" },
          { value: NONE_VALUE, label: "Без исполнителя" },
          ...members.map((m) => ({ value: m.user_id, label: m.name || m.email })),
        ];
      case "tag":
        return tags.map((t) => ({ value: t.id, label: t.name, color: t.color }));
      case "completed":
      case "has_parent":
        return [
          { value: "yes", label: "Да" },
          { value: "no", label: "Нет" },
        ];
      default: {
        const id = field.startsWith("field:") ? field.slice("field:".length) : null;
        const custom = id ? fields.find((f) => f.id === id) : undefined;
        if (!custom) return [];
        if (custom.type === "user") return members.map((m) => ({ value: m.user_id, label: m.name || m.email }));
        if (custom.type === "checkbox") {
          return [
            { value: "yes", label: "Да" },
            { value: "no", label: "Нет" },
          ];
        }
        return custom.options.map((o) => ({ value: o.id, label: o.label, color: o.color }));
      }
    }
  }

  function patchCondition(groupId: string, condId: string, patch: Partial<FilterCondition>) {
    setGroups(
      groups.map((g) =>
        g.id !== groupId
          ? g
          : { ...g, conditions: g.conditions.map((c) => (c.id === condId ? { ...c, ...patch } : c)) },
      ),
    );
  }

  function addGroup() {
    const group: FilterGroup = {
      id: newId(),
      logic: "and",
      conditions: [{ id: newId(), field: "status", operator: "is", value: "" }],
    };
    setGroups([...groups, group]);
  }

  function addCondition(groupId: string) {
    setGroups(
      groups.map((g) =>
        g.id !== groupId
          ? g
          : { ...g, conditions: [...g.conditions, { id: newId(), field: "status", operator: "is", value: "" }] },
      ),
    );
  }

  function removeCondition(groupId: string, condId: string) {
    setGroups(
      groups
        .map((g) => (g.id !== groupId ? g : { ...g, conditions: g.conditions.filter((c) => c.id !== condId) }))
        // Группа без условий ничего не фильтрует — убираем, чтобы не мозолила глаза.
        .filter((g) => g.conditions.length > 0),
    );
  }

  return (
    <div className="flex flex-col gap-2.5">
      {groups.length === 0 && (
        <p className="px-1 text-xs text-muted-foreground">
          Условий нет — показаны все доступные задачи. Группы объединяются через «И».
        </p>
      )}

      {groups.map((group, gi) => (
        <div key={group.id} className="rounded-lg border border-border p-2">
          <div className="mb-1.5 flex items-center gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              {gi === 0 ? "Группа" : "И группа"} {gi + 1}
            </span>
            <div className="flex overflow-hidden rounded-md border border-border">
              {(["and", "or"] as const).map((logic) => (
                <button
                  key={logic}
                  onClick={() =>
                    setGroups(groups.map((g) => (g.id === group.id ? { ...g, logic } : g)))
                  }
                  className={cn(
                    "px-1.5 py-0.5 text-[11px]",
                    group.logic === logic ? "bg-primary text-primary-foreground" : "hover:bg-muted",
                  )}
                >
                  {logic === "and" ? "И" : "ИЛИ"}
                </button>
              ))}
            </div>
            <button
              onClick={() => setGroups(groups.filter((g) => g.id !== group.id))}
              className="ml-auto rounded p-1 text-muted-foreground hover:bg-muted hover:text-destructive"
              title="Удалить группу"
            >
              <Trash2 className="size-3.5" />
            </button>
          </div>

          <div className="flex flex-col gap-1.5">
            {group.conditions.map((cond) => {
              const meta = fieldMetaFor(cond.field, fields);
              const operators = OPERATORS_BY_KIND[meta.kind];
              const options = optionsFor(cond.field);
              const needsValue = !VALUELESS_OPERATORS.has(cond.operator);
              return (
                <div key={cond.id} className="flex items-center gap-1.5">
                  <select
                    value={cond.field}
                    onChange={(e) => {
                      const nextField = e.target.value as FilterField;
                      const nextMeta = fieldMetaFor(nextField, fields);
                      const nextOps = OPERATORS_BY_KIND[nextMeta.kind];
                      // Оператор может не подходить новому полю — берём первый допустимый.
                      patchCondition(group.id, cond.id, {
                        field: nextField,
                        operator: nextOps.includes(cond.operator) ? cond.operator : nextOps[0],
                        value: "",
                      });
                    }}
                    className={cn(SELECT_CLS, "w-28 shrink-0")}
                  >
                    {fieldOptions.map((f) => (
                      <option key={f.field} value={f.field}>
                        {f.label}
                      </option>
                    ))}
                  </select>

                  <select
                    value={cond.operator}
                    onChange={(e) =>
                      patchCondition(group.id, cond.id, { operator: e.target.value as FilterOperator })
                    }
                    className={cn(SELECT_CLS, "w-24 shrink-0")}
                  >
                    {operators.map((op) => (
                      <option key={op} value={op}>
                        {OPERATOR_LABELS[op]}
                      </option>
                    ))}
                  </select>

                  {needsValue &&
                    (meta.kind === "date" ? (
                      <input
                        type="date"
                        value={cond.value}
                        onChange={(e) => patchCondition(group.id, cond.id, { value: e.target.value })}
                        className={cn(SELECT_CLS, "flex-1")}
                      />
                    ) : meta.kind === "text" ? (
                      <input
                        value={cond.value}
                        onChange={(e) => patchCondition(group.id, cond.id, { value: e.target.value })}
                        placeholder="Текст"
                        className={cn(SELECT_CLS, "flex-1")}
                      />
                    ) : (
                      <select
                        value={cond.value}
                        onChange={(e) => patchCondition(group.id, cond.id, { value: e.target.value })}
                        className={cn(SELECT_CLS, "flex-1")}
                      >
                        <option value="">— выберите —</option>
                        {options.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    ))}
                  {!needsValue && <span className="flex-1" />}

                  <button
                    onClick={() => removeCondition(group.id, cond.id)}
                    className="shrink-0 rounded p-1 text-muted-foreground hover:bg-muted hover:text-destructive"
                    title="Удалить условие"
                  >
                    <X className="size-3.5" />
                  </button>
                </div>
              );
            })}
          </div>

          <button
            onClick={() => addCondition(group.id)}
            className="mt-1.5 flex items-center gap-1 rounded px-1 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <Plus className="size-3" /> Условие
          </button>
        </div>
      ))}

      <div className="flex items-center gap-1.5">
        <Button variant="outline" size="xs" onClick={addGroup} className="gap-1">
          <Plus className="size-3" /> Группа условий
        </Button>
        {groups.length > 0 && (
          <Button variant="ghost" size="xs" onClick={() => setGroups([])}>
            Очистить
          </Button>
        )}
      </div>
    </div>
  );
}
