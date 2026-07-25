// Доска проекта: карточка проекта и её задачи считаются на сервере одним
// проходом. Раньше браузер после гидрации слал сюда два запроса, и каждый
// заново поднимал сессию, членство и роли проектов.

import { notFound } from "next/navigation";
import { getActiveOrgAuth } from "@/lib/core/bootstrap";
import { isUuid } from "@/lib/core/http";
import { effectiveProjectRole } from "@/lib/core/policy";
import { listProjectMembers, listSections, requireProject } from "@/lib/core/projects";
import { listProjectTasks } from "@/lib/core/tasks";
import { ProjectBoardClient } from "./ProjectBoardClient";

export default async function ProjectBoardPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const auth = await getActiveOrgAuth();
  if (!auth) return null;
  if (!isUuid(projectId)) notFound();

  // requireProject бросает PolicyError на чужой проект — для экрана это 404:
  // подтверждать существование приватного проекта нельзя.
  let project;
  try {
    project = await requireProject(auth, projectId, "project.view");
  } catch {
    notFound();
  }

  const [sections, members, tasks] = await Promise.all([
    listSections(projectId),
    listProjectMembers(projectId),
    listProjectTasks(auth, projectId, { includeDone: false }),
  ]);

  return (
    <ProjectBoardClient
      projectId={projectId}
      initialProject={{
        ...project,
        my_role: effectiveProjectRole(auth, project),
        sections,
        members,
      }}
      initialTasks={tasks}
    />
  );
}
