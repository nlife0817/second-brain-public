"use client";

// Выбор базовой роли проекта — того самого параметра, которым проект решает,
// что доступно сотрудникам организации без явной записи в участниках.
// Зеркало core.projects.default_role и effectiveProjectRole() в policy.ts.

import { Eye, Lock, MessageSquare, Pencil, type LucideIcon } from "lucide-react";
import type { ProjectDefaultRole } from "@/lib/core/types";
import { cn } from "@/lib/utils";

export type ProjectAccessValue = ProjectDefaultRole | null;

export const PROJECT_ACCESS_OPTIONS: Array<{
  value: ProjectAccessValue;
  label: string;
  hint: string;
  icon: LucideIcon;
}> = [
  {
    value: null,
    label: "Закрытый",
    hint: "Только участники из списка ниже — включая администраторов организации",
    icon: Lock,
  },
  {
    value: "viewer",
    label: "Наблюдение",
    hint: "Все сотрудники видят задачи, изменяют — только участники",
    icon: Eye,
  },
  {
    value: "commenter",
    label: "Комментирование",
    hint: "Все сотрудники видят задачи и комментируют их",
    icon: MessageSquare,
  },
  {
    value: "editor",
    label: "Редактирование",
    hint: "Все сотрудники создают и редактируют задачи проекта",
    icon: Pencil,
  },
];

export function accessLabel(value: ProjectAccessValue): string {
  return PROJECT_ACCESS_OPTIONS.find((o) => o.value === value)?.label ?? "Закрытый";
}

export function ProjectAccessPicker({
  value,
  onChange,
  disabled,
}: {
  value: ProjectAccessValue;
  onChange: (value: ProjectAccessValue) => void;
  disabled?: boolean;
}) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {PROJECT_ACCESS_OPTIONS.map((option) => {
        const Icon = option.icon;
        const active = option.value === value;
        return (
          <button
            key={option.label}
            type="button"
            disabled={disabled}
            onClick={() => onChange(option.value)}
            className={cn(
              "flex items-start gap-2.5 rounded-lg border p-3 text-left transition-colors",
              active ? "border-primary bg-muted" : "border-border",
              disabled ? "cursor-not-allowed opacity-60" : "hover:bg-muted/60",
            )}
          >
            <Icon className={cn("mt-0.5 size-4 shrink-0", active ? "text-primary" : "text-muted-foreground")} />
            <span className="min-w-0">
              <span className="block text-sm font-medium">{option.label}</span>
              <span className="block text-xs text-muted-foreground">{option.hint}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
