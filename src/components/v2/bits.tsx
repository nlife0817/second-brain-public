"use client";

// Мелкие переиспользуемые элементы UI v2.

import type { CSSProperties } from "react";
import { cn } from "@/lib/utils";
import type { TaskPriority, TaskStatus, UserBrief } from "@/lib/core/types";

/**
 * Цвет сущности для метки `.tinted-chip` (см. globals.css): подложку и текст
 * из него выводит CSS, инлайном цвет напрямую не назначаем — сырой цвет
 * текстом не проходит по контрасту.
 */
export function chipStyle(color: string | null | undefined): CSSProperties {
  return { "--chip-color": color ?? "#94a3b8" } as CSSProperties;
}

export const PRIORITY_LABELS: Record<TaskPriority, { label: string; dot: string }> = {
  urgent: { label: "Срочно", dot: "bg-red-500" },
  high: { label: "Высокий", dot: "bg-orange-500" },
  medium: { label: "Средний", dot: "bg-yellow-500" },
  low: { label: "Низкий", dot: "bg-blue-500" },
  none: { label: "Без приоритета", dot: "bg-gray-300 dark:bg-gray-600" },
};

export function PriorityDot({ priority, className }: { priority: TaskPriority; className?: string }) {
  if (priority === "none") return null;
  return (
    <span
      title={PRIORITY_LABELS[priority].label}
      className={cn("inline-block size-2 shrink-0 rounded-full", PRIORITY_LABELS[priority].dot, className)}
    />
  );
}

export function initials(user: Pick<UserBrief, "name" | "email">): string {
  const source = user.name.trim() || user.email;
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return source.slice(0, 2).toUpperCase();
}

/* Скруглённые квадраты с градиентом — манера DS «Твой репетитор». */
const AVATAR_COLORS = [
  "bg-linear-to-br from-rose-500 to-rose-400",
  "bg-linear-to-br from-orange-500 to-orange-400",
  "bg-linear-to-br from-amber-500 to-amber-400",
  "bg-linear-to-br from-emerald-500 to-emerald-400",
  "bg-linear-to-br from-teal-500 to-teal-400",
  "bg-linear-to-br from-sky-500 to-sky-400",
  "bg-linear-to-br from-indigo-500 to-indigo-400",
  "bg-linear-to-br from-violet-500 to-violet-400",
  "bg-linear-to-br from-fuchsia-500 to-fuchsia-400",
];

const AVATAR_RADIUS = { xs: "rounded-[7px]", sm: "rounded-[8px]", md: "rounded-[10px]" } as const;

export function Avatar({ user, size = "sm" }: { user: UserBrief; size?: "xs" | "sm" | "md" }) {
  const colorIdx = [...user.id].reduce((a, c) => a + c.charCodeAt(0), 0) % AVATAR_COLORS.length;
  const sizeCls = size === "xs" ? "size-5 text-[9px]" : size === "sm" ? "size-6 text-[10px]" : "size-8 text-xs";
  return (
    <span
      title={user.name || user.email}
      className={cn(
        "inline-flex shrink-0 items-center justify-center font-semibold text-white",
        AVATAR_COLORS[colorIdx],
        AVATAR_RADIUS[size],
        sizeCls,
      )}
    >
      {initials(user)}
    </span>
  );
}

export function AvatarStack({ users, max = 3 }: { users: UserBrief[]; max?: number }) {
  const shown = users.slice(0, max);
  const rest = users.length - shown.length;
  return (
    <span className="flex -space-x-1.5">
      {shown.map((u) => (
        <span key={u.id} className="rounded-[7px] ring-2 ring-background">
          <Avatar user={u} size="xs" />
        </span>
      ))}
      {rest > 0 && (
        <span className="inline-flex size-5 items-center justify-center rounded-[7px] bg-muted text-[9px] font-medium text-muted-foreground ring-2 ring-background">
          +{rest}
        </span>
      )}
    </span>
  );
}

export function StatusPill({ status }: { status: TaskStatus | undefined }) {
  if (!status) return <span className="text-xs text-muted-foreground">Без статуса</span>;
  return (
    <span
      className="tinted-chip inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium"
      style={chipStyle(status.color)}
    >
      <span className="size-1.5 rounded-full" style={{ backgroundColor: status.color }} />
      {status.name}
    </span>
  );
}

export function formatDue(due_date: string | null, due_time: string | null): string | null {
  if (!due_date) return null;
  const [y, m, d] = due_date.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  const label = date.toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
  return due_time ? `${label}, ${due_time.slice(0, 5)}` : label;
}

export function dueTone(due_date: string | null, completed: boolean): string {
  if (!due_date || completed) return "text-muted-foreground";
  const today = new Date();
  const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  // 700-я ступень, а не 600: «сегодня» на 12px должно проходить контраст 4.5:1.
  if (due_date < iso) return "text-red-600 dark:text-red-400";
  if (due_date === iso) return "text-amber-700 dark:text-amber-400";
  return "text-muted-foreground";
}
