import { NextResponse } from "next/server";
import { withOrg } from "@/lib/core/context";
import { isUuid, jsonError, parseJson } from "@/lib/core/http";
import { sprintCompleteSchema } from "@/lib/core/schemas";
import { completeSprint, listSprintLeftovers } from "@/lib/core/sprints";

/** Что осталось незакрытым — диалог завершения показывает это списком. */
export const GET = withOrg(async (_request, { params, auth }) => {
  const { sprintId } = await params;
  if (!isUuid(sprintId)) return jsonError(404, "Sprint not found");
  return NextResponse.json(await listSprintLeftovers(auth, sprintId));
});

export const POST = withOrg(async (request, { params, auth }) => {
  const { sprintId } = await params;
  if (!isUuid(sprintId)) return jsonError(404, "Sprint not found");
  const [body, invalid] = await parseJson(request, sprintCompleteSchema);
  if (invalid) return invalid;
  return NextResponse.json(await completeSprint(auth, sprintId, body));
});
