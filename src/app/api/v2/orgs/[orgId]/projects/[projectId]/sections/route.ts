import { NextResponse } from "next/server";
import { withOrg } from "@/lib/core/context";
import { isUuid, jsonError, parseJson } from "@/lib/core/http";
import { createSection } from "@/lib/core/projects";
import { sectionCreateSchema } from "@/lib/core/schemas";

export const POST = withOrg(async (request, { params, auth }) => {
  const { projectId } = await params;
  if (!isUuid(projectId)) return jsonError(404, "Project not found");
  const [body, invalid] = await parseJson(request, sectionCreateSchema);
  if (invalid) return invalid;
  const section = await createSection(auth, projectId, body.name);
  return NextResponse.json(section, { status: 201 });
});
