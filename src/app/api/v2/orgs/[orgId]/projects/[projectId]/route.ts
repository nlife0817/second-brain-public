import { NextResponse } from "next/server";
import { withOrg } from "@/lib/core/context";
import { isUuid, jsonError, parseJson } from "@/lib/core/http";
import { effectiveProjectRole } from "@/lib/core/policy";
import {
  listProjectMembers,
  listSections,
  requireProject,
  setProjectArchived,
  updateProject,
} from "@/lib/core/projects";
import { projectPatchSchema } from "@/lib/core/schemas";
import { setProjectTeam } from "@/lib/core/teams";

export const GET = withOrg(async (_request, { params, auth }) => {
  const { projectId } = await params;
  if (!isUuid(projectId)) return jsonError(404, "Project not found");
  const project = await requireProject(auth, projectId, "project.view");
  const [sections, members] = await Promise.all([
    listSections(projectId),
    listProjectMembers(projectId),
  ]);
  return NextResponse.json({
    ...project,
    my_role: effectiveProjectRole(auth, project),
    sections,
    members,
  });
});

export const PATCH = withOrg(async (request, { params, auth }) => {
  const { projectId } = await params;
  if (!isUuid(projectId)) return jsonError(404, "Project not found");
  const [body, invalid] = await parseJson(request, projectPatchSchema);
  if (invalid) return invalid;
  const { archived, team_id, ...patch } = body;
  if (archived !== undefined) {
    await setProjectArchived(auth, projectId, archived);
  }
  if (team_id !== undefined) {
    await setProjectTeam(auth, projectId, team_id);
  }
  const project =
    Object.keys(patch).length > 0
      ? await updateProject(auth, projectId, patch)
      : await requireProject(auth, projectId, "project.view");
  return NextResponse.json({ ...project, my_role: effectiveProjectRole(auth, project) });
});
