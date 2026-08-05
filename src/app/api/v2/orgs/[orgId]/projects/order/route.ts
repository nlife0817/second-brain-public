import { NextResponse } from "next/server";
import { withOrg } from "@/lib/core/context";
import { parseJson } from "@/lib/core/http";
import { reorderProjects } from "@/lib/core/projects";
import { projectOrderSchema } from "@/lib/core/schemas";

// Порядок проектов целиком — одним запросом, как порядок статусов: перетаскивание
// сдвигает соседей, а PATCH по проекту оставлял бы панель в промежуточном
// состоянии между запросами. В ответе — тот же список, что отдаёт GET.
export const PUT = withOrg(async (request, { auth }) => {
  const [body, invalid] = await parseJson(request, projectOrderSchema);
  if (invalid) return invalid;
  return NextResponse.json(await reorderProjects(auth, body.order));
});
