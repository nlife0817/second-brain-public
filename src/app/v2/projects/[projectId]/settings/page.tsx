// Настройки проекта: доступ сотрудников, параметры, секции, архив и удаление.
// Данные считаются на сервере — как и на доске, экран открывается без единого
// запроса из браузера.

import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { ProjectIcon } from "@/components/v2/project-icons";
import { ProjectSettings } from "@/components/v2/ProjectSettings";
import { getActiveOrgAuth } from "@/lib/core/bootstrap";
import { isUuid } from "@/lib/core/http";
import { canOrg, effectiveProjectRole } from "@/lib/core/policy";
import { listProjectMembers, requireProject } from "@/lib/core/projects";
import { listTeams } from "@/lib/core/teams";

export default async function ProjectSettingsPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const auth = await getActiveOrgAuth();
  if (!auth) return null;
  if (!isUuid(projectId)) notFound();

  // Чужой или невидимый проект — 404: подтверждать существование закрытого нельзя.
  let project;
  try {
    project = await requireProject(auth, projectId, "project.view");
  } catch {
    notFound();
  }

  const [members, teams] = await Promise.all([
    listProjectMembers(projectId),
    // Структура организации не для гостей — listTeams бросил бы PolicyError.
    canOrg(auth, "clients.view") ? listTeams(auth) : Promise.resolve([]),
  ]);

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
        <ProjectIcon name={project.icon} color={project.color} className="size-4" />
        <h1 className="font-heading text-xl font-semibold tracking-tight">{project.name} · настройки</h1>
      </header>
      <ProjectSettings
        projectId={projectId}
        initialProject={{
          ...project,
          my_role: effectiveProjectRole(auth, project),
          members,
        }}
        teams={teams}
        exitHref="/v2"
      />
    </div>
  );
}
