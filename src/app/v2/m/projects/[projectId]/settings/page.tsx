"use client";

// Настройки проекта на мобильном: тот же экран, что и на десктопе, — правила
// доступа не должны выглядеть по-разному в двух оболочках.

import Link from "next/link";
import { use } from "react";
import { ChevronLeft } from "lucide-react";
import { ProjectSettings } from "@/components/v2/ProjectSettings";
import { ProjectIcon } from "@/components/v2/project-icons";
import { useV2Store } from "@/lib/core/ui-store";

export default function MobileProjectSettingsPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = use(params);
  const { projects } = useV2Store();
  const project = projects.find((p) => p.id === projectId);

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <header className="flex shrink-0 items-center gap-1.5 border-b border-border py-2 pl-1 pr-3">
        <Link
          href={`/v2/m/projects/${projectId}`}
          className="rounded-lg p-2 text-muted-foreground active:bg-muted"
          aria-label="Назад к проекту"
        >
          <ChevronLeft className="size-5" />
        </Link>
        {project && <ProjectIcon name={project.icon} color={project.color} className="size-4 shrink-0" />}
        <h1 className="min-w-0 flex-1 truncate text-base font-semibold">
          {project ? project.name : "Настройки проекта"}
        </h1>
      </header>
      <ProjectSettings projectId={projectId} exitHref="/v2/m/projects" />
    </div>
  );
}
