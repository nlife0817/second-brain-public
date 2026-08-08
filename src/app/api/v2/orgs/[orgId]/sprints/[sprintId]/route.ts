import { NextResponse } from "next/server";
import { withOrg } from "@/lib/core/context";
import { isUuid, jsonError, parseJson } from "@/lib/core/http";
import { sprintPatchSchema } from "@/lib/core/schemas";
import { deleteSprint, requireSprint, updateSprint } from "@/lib/core/sprints";

export const GET = withOrg(async (_request, { params, auth }) => {
  const { sprintId } = await params;
  if (!isUuid(sprintId)) return jsonError(404, "Sprint not found");
  return NextResponse.json(await requireSprint(auth, sprintId, "project.view"));
});

export const PATCH = withOrg(async (request, { params, auth }) => {
  const { sprintId } = await params;
  if (!isUuid(sprintId)) return jsonError(404, "Sprint not found");
  const [body, invalid] = await parseJson(request, sprintPatchSchema);
  if (invalid) return invalid;
  return NextResponse.json(await updateSprint(auth, sprintId, body));
});

export const DELETE = withOrg(async (_request, { params, auth }) => {
  const { sprintId } = await params;
  if (!isUuid(sprintId)) return jsonError(404, "Sprint not found");
  await deleteSprint(auth, sprintId);
  return NextResponse.json({ ok: true });
});
