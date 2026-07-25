import { NextResponse } from "next/server";
import { withOrg } from "@/lib/core/context";
import { isUuid, jsonError, parseJson } from "@/lib/core/http";
import { listProjectMembers, requireProject, upsertProjectMember } from "@/lib/core/projects";
import { projectMemberSchema } from "@/lib/core/schemas";

export const GET = withOrg(async (_request, { params, auth }) => {
  const { projectId } = await params;
  if (!isUuid(projectId)) return jsonError(404, "Project not found");
  await requireProject(auth, projectId, "project.view");
  return NextResponse.json(await listProjectMembers(projectId));
});

export const POST = withOrg(async (request, { params, auth }) => {
  const { projectId } = await params;
  if (!isUuid(projectId)) return jsonError(404, "Project not found");
  const [body, invalid] = await parseJson(request, projectMemberSchema);
  if (invalid) return invalid;
  await upsertProjectMember(auth, projectId, body.user_id, body.role);
  return NextResponse.json({ ok: true }, { status: 201 });
});
