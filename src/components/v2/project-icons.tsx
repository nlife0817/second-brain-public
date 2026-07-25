"use client";

// Иконка проекта: в БД хранится имя (core.projects.icon), а не компонент, поэтому
// набор фиксирован — произвольное имя из lucide тянуло бы весь пакет в бандл.

import {
  Bug,
  Briefcase,
  Code,
  Folder,
  FolderKanban,
  Handshake,
  Layers,
  LineChart,
  Megaphone,
  Palette,
  Rocket,
  Target,
  Users,
  Wrench,
  type LucideIcon,
} from "lucide-react";

export const PROJECT_ICONS: Record<string, LucideIcon> = {
  Folder,
  FolderKanban,
  Layers,
  Briefcase,
  Rocket,
  Target,
  LineChart,
  Bug,
  Code,
  Palette,
  Megaphone,
  Handshake,
  Users,
  Wrench,
};

export const PROJECT_ICON_NAMES = Object.keys(PROJECT_ICONS);

/** Палитра проекта: общая для создания и настроек, чтобы цвета не разъезжались. */
export const PROJECT_COLORS = [
  "#6b7280", "#ef4444", "#f59e0b", "#10b981",
  "#3b82f6", "#8b5cf6", "#ec4899", "#14b8a6",
];

/** Иконка проекта, окрашенная его цветом; неизвестное имя падает на папку. */
export function ProjectIcon({
  name,
  color,
  className,
}: {
  name: string;
  color?: string;
  className?: string;
}) {
  const Icon = PROJECT_ICONS[name] ?? Folder;
  return <Icon className={className} style={color ? { color } : undefined} />;
}
