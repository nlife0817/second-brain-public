import { NextResponse } from "next/server";
import { withOrg } from "@/lib/core/context";
import { isUuid, jsonError, parseJson } from "@/lib/core/http";
import { sprintCreateSchema } from "@/lib/core/schemas";
import { createSprint, listSprints } from "@/lib/core/sprints";

export const GET = withOrg(async (request, { params, auth }) => {
  const { projectId } = await params;
  if (!isUuid(projectId)) return jsonError(404, "Project not found");
  // Завершённые спринты в планировании не нужны, но нужны в истории — отдаём по
  // явной просьбе, как и завершённые задачи в списках.
  const includeCompleted = new URL(request.url).searchParams.get("completed") === "1";
  return NextResponse.json(await listSprints(auth, projectId, { includeCompleted }));
});

export const POST = withOrg(async (request, { params, auth }) => {
  const { projectId } = await params;
  if (!isUuid(projectId)) return jsonError(404, "Project not found");
  const [body, invalid] = await parseJson(request, sprintCreateSchema);
  if (invalid) return invalid;
  return NextResponse.json(await createSprint(auth, projectId, body), { status: 201 });
});
