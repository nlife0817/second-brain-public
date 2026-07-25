import { NextResponse } from "next/server";
import { withOrg } from "@/lib/core/context";
import { isUuid, jsonError, parseJson } from "@/lib/core/http";
import { taskMoveSchema, taskPlacementsSchema } from "@/lib/core/schemas";
import { moveTaskInProject, setTaskPlacements } from "@/lib/core/tasks";

/** PUT — задать полный список проектов задачи (multi-homing). */
export const PUT = withOrg(async (request, { params, auth }) => {
  const { taskId } = await params;
  if (!isUuid(taskId)) return jsonError(404, "Task not found");
  const [body, invalid] = await parseJson(request, taskPlacementsSchema);
  if (invalid) return invalid;
  return NextResponse.json(await setTaskPlacements(auth, taskId, body.placements));
});

/** POST — переместить в рамках одного проекта (секция/позиция, drag&drop). */
export const POST = withOrg(async (request, { params, auth }) => {
  const { taskId } = await params;
  if (!isUuid(taskId)) return jsonError(404, "Task not found");
  const [body, invalid] = await parseJson(request, taskMoveSchema);
  if (invalid) return invalid;
  await moveTaskInProject(auth, taskId, body.project_id, {
    section_id: body.section_id,
    position: body.position,
  });
  return NextResponse.json({ ok: true });
});
