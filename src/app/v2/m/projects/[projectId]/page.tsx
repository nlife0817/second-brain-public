import { notFound } from "next/navigation";
import { getActiveOrgAuth } from "@/lib/core/bootstrap";
import { isUuid } from "@/lib/core/http";
import { effectiveProjectRole } from "@/lib/core/policy";
import { listProjectMembers, requireProject } from "@/lib/core/projects";
import { listProjectTasks } from "@/lib/core/tasks";
import { MobileProjectClient } from "./MobileProjectClient";

export default async function MobileProjectPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const auth = await getActiveOrgAuth();
  if (!auth) return null;
  if (!isUuid(projectId)) notFound();

  // Чужой проект — 404: подтверждать существование приватного нельзя.
  let project;
  try {
    project = await requireProject(auth, projectId, "project.view");
  } catch {
    notFound();
  }

  const [members, tasks] = await Promise.all([
    listProjectMembers(projectId),
    listProjectTasks(auth, projectId, { includeDone: false }),
  ]);

  return (
    <MobileProjectClient
      projectId={projectId}
      initialProject={{
        ...project,
        my_role: effectiveProjectRole(auth, project),
        members,
      }}
      initialTasks={tasks}
    />
  );
}
