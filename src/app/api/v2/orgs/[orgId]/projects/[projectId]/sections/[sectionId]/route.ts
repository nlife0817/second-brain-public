import { NextResponse } from "next/server";
import { withOrg } from "@/lib/core/context";
import { isUuid, jsonError, parseJson } from "@/lib/core/http";
import { deleteSection, updateSection } from "@/lib/core/projects";
import { sectionPatchSchema } from "@/lib/core/schemas";

export const PATCH = withOrg(async (request, { params, auth }) => {
  const { projectId, sectionId } = await params;
  if (!isUuid(projectId) || !isUuid(sectionId)) return jsonError(404, "Section not found");
  const [body, invalid] = await parseJson(request, sectionPatchSchema);
  if (invalid) return invalid;
  return NextResponse.json(await updateSection(auth, projectId, sectionId, body));
});

export const DELETE = withOrg(async (_request, { params, auth }) => {
  const { projectId, sectionId } = await params;
  if (!isUuid(projectId) || !isUuid(sectionId)) return jsonError(404, "Section not found");
  await deleteSection(auth, projectId, sectionId);
  return NextResponse.json({ ok: true });
});
