// Зависимости между задачами для ганта: пары «источник блокирует цель».
// Отдаются пачкой на всю организацию — связей на порядки меньше, чем задач, а
// список показанных id в query-строке промахивался бы мимо кэша при каждом
// изменении фильтра. Отсев по видимости — внутри сервиса.

import { NextResponse } from "next/server";
import { withOrg } from "@/lib/core/context";
import { listTaskDependencies } from "@/lib/core/relations";

export const GET = withOrg(async (_request, { auth }) => {
  return NextResponse.json(await listTaskDependencies(auth));
});
