"use client";

// Настройки проекта на десктопе: доступ сотрудников, параметры, секции, архив.

import Link from "next/link";
import { use } from "react";
import { ChevronLeft } from "lucide-react";
import { ProjectSettings } from "@/components/v2/ProjectSettings";
import { ProjectIcon } from "@/components/v2/project-icons";
import { useV2Store } from "@/lib/core/ui-store";

export default function ProjectSettingsPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = use(params);
  const { projects } = useV2Store();
  const project = projects.find((p) => p.id === projectId);

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <header className="flex shrink-0 items-center gap-2 border-b border-border px-6 py-3.5">
        <Link
          href={`/v2/projects/${projectId}`}
          className="rounded-lg p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label="К доске проекта"
        >
          <ChevronLeft className="size-4" />
        </Link>
        {project && <ProjectIcon name={project.icon} color={project.color} className="size-4" />}
        <h1 className="text-base font-semibold">
          {project ? `${project.name} · настройки` : "Настройки проекта"}
        </h1>
      </header>
      <ProjectSettings projectId={projectId} exitHref="/v2" />
    </div>
  );
}
