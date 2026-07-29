"use client";

// Редакторы кастомных полей для черновика задачи. Общие для строчного ввода
// (внутри поповера ячейки) и для развёрнутой карточки справа — иначе одно и то
// же поле пришлось бы описывать дважды и они бы разъехались.

import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { CustomField } from "@/lib/core/types";
import { useV2Store } from "@/lib/core/ui-store";
import { cn } from "@/lib/utils";

/** Короткая подпись значения — то, что видно в ячейке строки добавления. */
export function describeFieldValue(field: CustomField, value: unknown): string | null {
  if (value == null || value === "" || (Array.isArray(value) && value.length === 0)) return null;
  switch (field.type) {
    case "checkbox":
      return value === true ? "Да" : "Нет";
    case "select":
      return field.options.find((o) => o.id === value)?.label ?? null;
    case "multi_select": {
      const ids = Array.isArray(value) ? (value as string[]) : [];
      const labels = ids
        .map((id) => field.options.find((o) => o.id === id)?.label)
        .filter((l): l is string => Boolean(l));
      return labels.length > 0 ? labels.join(", ") : null;
    }
    default:
      return String(value);
  }
}

export function DraftFieldControl({
  field,
  value,
  onChange,
  className,
}: {
  field: CustomField;
  value: unknown;
  onChange: (value: unknown) => void;
  className?: string;
}) {
  const members = useV2Store((s) => s.members);

  switch (field.type) {
    case "number":
      return (
        <Input
          type="number"
          value={typeof value === "number" ? String(value) : ""}
          onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
          className={cn("h-8 text-sm", className)}
        />
      );
    case "date":
      return (
        <input
          type="date"
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value || null)}
          className={cn(
            "h-8 rounded-lg border border-input bg-transparent px-2 text-sm text-foreground outline-none focus-visible:border-ring",
            className,
          )}
        />
      );
    case "checkbox":
      return (
        <input
          type="checkbox"
          checked={value === true}
          onChange={(e) => onChange(e.target.checked ? true : null)}
          className={cn("size-4 accent-primary", className)}
        />
      );
    case "select":
      return (
        <Select
          value={typeof value === "string" ? value : ""}
          onValueChange={(v) => onChange(v || null)}
        >
          <SelectTrigger size="sm" className={cn("w-full min-w-32", className)}>
            {/* SelectValue без children покажет сырой uuid. */}
            <SelectValue placeholder="—">
              {field.options.find((o) => o.id === value)?.label ?? "—"}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {field.options.map((o) => (
              <SelectItem key={o.id} value={o.id}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    case "multi_select": {
      const selected = Array.isArray(value) ? (value as string[]) : [];
      return (
        <div className={cn("flex flex-wrap gap-1", className)}>
          {field.options.map((o) => {
            const active = selected.includes(o.id);
            return (
              <button
                key={o.id}
                type="button"
                onClick={() =>
                  onChange(active ? selected.filter((x) => x !== o.id) : [...selected, o.id])
                }
                className={cn(
                  "rounded-full border px-2 py-0.5 text-[11px]",
                  active ? "border-primary bg-muted font-medium" : "border-border text-muted-foreground",
                )}
              >
                {o.label}
              </button>
            );
          })}
          {field.options.length === 0 && (
            <span className="text-xs text-muted-foreground">Вариантов нет</span>
          )}
        </div>
      );
    }
    case "user":
      return (
        <Select
          value={typeof value === "string" ? value : ""}
          onValueChange={(v) => onChange(v || null)}
        >
          <SelectTrigger size="sm" className={cn("w-full min-w-36", className)}>
            <SelectValue placeholder="—">
              {(() => {
                const m = members.find((x) => x.user_id === value);
                return m ? m.name || m.email : "—";
              })()}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {members.map((m) => (
              <SelectItem key={m.user_id} value={m.user_id}>
                {m.name || m.email}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    default:
      return (
        <Input
          value={typeof value === "string" ? value : ""}
          placeholder={field.type === "url" ? "https://…" : undefined}
          onChange={(e) => onChange(e.target.value || null)}
          className={cn("h-8 text-sm", className)}
        />
      );
  }
}
