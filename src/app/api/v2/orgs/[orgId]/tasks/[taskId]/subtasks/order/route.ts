import { NextResponse } from "next/server";
import { withOrg } from "@/lib/core/context";
import { isUuid, jsonError, parseJson } from "@/lib/core/http";
import { subtaskOrderSchema } from "@/lib/core/schemas";
import { reorderSubtasks } from "@/lib/core/tasks";

// Порядок ветки целиком — одним запросом: перетаскивание одной подзадачи
// сдвигает соседей, и патч позиции по строке оставлял бы список в промежуточном
// состоянии между запросами.
export const PUT = withOrg(async (request, { params, auth }) => {
  const { taskId } = await params;
  if (!isUuid(taskId)) return jsonError(404, "Task not found");
  const [body, invalid] = await parseJson(request, subtaskOrderSchema);
  if (invalid) return invalid;
  return NextResponse.json(await reorderSubtasks(auth, taskId, body.task_ids));
});
