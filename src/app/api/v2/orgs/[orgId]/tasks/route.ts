import { NextResponse } from "next/server";
import { withOrg } from "@/lib/core/context";
import { parseJson } from "@/lib/core/http";
import { taskCreateSchema } from "@/lib/core/schemas";
import { createTask, listAllTasks, listMyTasks } from "@/lib/core/tasks";

/**
 * GET /tasks              — «Мои задачи» (назначенные мне + личный инбокс)
 * GET /tasks?view=all     — сводный список по всем доступным проектам
 *   &done=1               — включая завершённые
 *   &archived=1           — включая задачи архивных проектов (только для view=all)
 */
export const GET = withOrg(async (request, { auth }) => {
  const params = request.nextUrl.searchParams;
  const includeDone = params.get("done") === "1";
  if (params.get("view") === "all") {
    return NextResponse.json(
      await listAllTasks(auth, {
        includeDone,
        includeArchivedProjects: params.get("archived") === "1",
      }),
    );
  }
  return NextResponse.json(await listMyTasks(auth, { includeDone }));
});

export const POST = withOrg(async (request, { auth }) => {
  const [body, invalid] = await parseJson(request, taskCreateSchema);
  if (invalid) return invalid;
  const task = await createTask(auth, body);
  return NextResponse.json(task, { status: 201 });
});
