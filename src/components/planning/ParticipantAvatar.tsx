"use client";

import type { DevelopmentParticipant } from "@/types";

interface Props {
  participant: Pick<DevelopmentParticipant, "id" | "name" | "role" | "is_active"> | null | undefined;
  size?: "xs" | "sm" | "md";
  className?: string;
  title?: string;
}

// Стабильный цвет фона из id — чтобы одинаковый человек выглядел одинаково везде.
function colorFromId(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  const palette = [
    "bg-blue-500", "bg-emerald-500", "bg-violet-500", "bg-amber-500",
    "bg-rose-500", "bg-teal-500", "bg-indigo-500", "bg-pink-500",
    "bg-orange-500", "bg-cyan-600",
  ];
  return palette[h % palette.length];
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

export function ParticipantAvatar({ participant, size = "sm", className = "", title }: Props) {
  const sizeClass = size === "xs" ? "size-4 text-[8px]" : size === "md" ? "size-7 text-xs" : "size-5 text-[9px]";
  if (!participant) {
    return (
      <span
        className={`inline-flex shrink-0 items-center justify-center rounded-full bg-slate-300 font-semibold text-white ${sizeClass} ${className}`}
        title={title ?? "Не назначено"}
      >
        ·
      </span>
    );
  }
  const bg = participant.role === "owner" ? "bg-slate-700" : colorFromId(participant.id);
  const opacity = participant.is_active === false ? "opacity-60" : "";
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white ${bg} ${sizeClass} ${opacity} ${className}`}
      title={title ?? participant.name}
    >
      {initials(participant.name)}
    </span>
  );
}
