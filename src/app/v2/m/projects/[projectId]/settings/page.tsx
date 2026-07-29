// Настройки проекта на мобильном: тот же экран, что и на десктопе, — правила
// доступа не должны выглядеть по-разному в двух оболочках.

import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { ProjectIcon } from "@/components/v2/project-icons";
import { ProjectSettings } from "@/components/v2/ProjectSettings";
import { getActiveOrgAuth } from "@/lib/core/bootstrap";
import { isUuid } from "@/lib/core/http";
import { canOrg, effectiveProjectRole } from "@/lib/core/policy";
import { listProjectMembers, listSections, requireProject } from "@/lib/core/projects";
import { listTeams } from "@/lib/core/teams";

export default async function MobileProjectSettingsPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const auth = await getActiveOrgAuth();
  if (!auth) return null;
  if (!isUuid(projectId)) notFound();

  let project;
  try {
    project = await requireProject(auth, projectId, "project.view");
  } catch {
    notFound();
  }

  const [sections, members, teams] = await Promise.all([
    listSections(projectId),
    listProjectMembers(projectId),
    canOrg(auth, "clients.view") ? listTeams(auth) : Promise.resolve([]),
  ]);

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
        <ProjectIcon name={project.icon} color={project.color} className="size-4 shrink-0" />
        <h1 className="min-w-0 flex-1 truncate font-heading text-lg font-semibold tracking-tight">{project.name}</h1>
      </header>
      <ProjectSettings
        projectId={projectId}
        initialProject={{
          ...project,
          my_role: effectiveProjectRole(auth, project),
          sections,
          members,
        }}
        teams={teams}
        exitHref="/v2/m/projects"
      />
    </div>
  );
}
