// Зависимости между задачами для ганта: пары «источник блокирует цель».
// Отдаются пачкой на всю организацию — связей на порядки меньше, чем задач, а
// список показанных id в query-строке промахивался бы мимо кэша при каждом
// изменении фильтра. Отсев по видимости — внутри сервиса.
//
// Создание и удаление адресуют связь концами, а не её id: полотно оперирует
// парой задач, id связи ему негде взять и незачем помнить.

import { NextResponse } from "next/server";
import { withOrg } from "@/lib/core/context";
import { jsonError, parseJson } from "@/lib/core/http";
import { createTaskDependency, deleteTaskDependency, listTaskDependencies } from "@/lib/core/relations";
import { dependencySchema } from "@/lib/core/schemas";

export const GET = withOrg(async (_request, { auth }) => {
  return NextResponse.json(await listTaskDependencies(auth));
});

export const POST = withOrg(async (request, { auth }) => {
  const [body, invalid] = await parseJson(request, dependencySchema);
  if (invalid) return invalid;
  return NextResponse.json(await createTaskDependency(auth, body.from, body.to), { status: 201 });
});

/** DELETE /dependencies?from=<uuid>&to=<uuid> — тело у DELETE доходит не через все прослойки. */
export const DELETE = withOrg(async (request, { auth }) => {
  const parsed = dependencySchema.safeParse({
    from: request.nextUrl.searchParams.get("from"),
    to: request.nextUrl.searchParams.get("to"),
  });
  if (!parsed.success) return jsonError(422, "from and to are required");
  await deleteTaskDependency(auth, parsed.data.from, parsed.data.to);
  return new NextResponse(null, { status: 204 });
});
