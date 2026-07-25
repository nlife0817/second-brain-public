"use client";

// Мелкие переиспользуемые элементы UI v2.

import { cn } from "@/lib/utils";
import type { TaskPriority, TaskStatus, UserBrief } from "@/lib/core/types";

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

const AVATAR_COLORS = [
  "bg-rose-500", "bg-orange-500", "bg-amber-500", "bg-emerald-500",
  "bg-teal-500", "bg-sky-500", "bg-indigo-500", "bg-violet-500", "bg-fuchsia-500",
];

export function Avatar({ user, size = "sm" }: { user: UserBrief; size?: "xs" | "sm" | "md" }) {
  const colorIdx = [...user.id].reduce((a, c) => a + c.charCodeAt(0), 0) % AVATAR_COLORS.length;
  const sizeCls = size === "xs" ? "size-5 text-[9px]" : size === "sm" ? "size-6 text-[10px]" : "size-8 text-xs";
  return (
    <span
      title={user.name || user.email}
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white",
        AVATAR_COLORS[colorIdx],
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
        <span key={u.id} className="rounded-full ring-2 ring-background">
          <Avatar user={u} size="xs" />
        </span>
      ))}
      {rest > 0 && (
        <span className="inline-flex size-5 items-center justify-center rounded-full bg-muted text-[9px] font-medium text-muted-foreground ring-2 ring-background">
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
      className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium"
      style={{ backgroundColor: `${status.color}1a`, color: status.color }}
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
  if (due_date < iso) return "text-red-600 dark:text-red-400";
  if (due_date === iso) return "text-amber-600 dark:text-amber-400";
  return "text-muted-foreground";
}
