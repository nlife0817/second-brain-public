import { NextResponse } from "next/server";
import { withOrg } from "@/lib/core/context";
import { parseJson } from "@/lib/core/http";
import { reorderStatuses } from "@/lib/core/orgmeta";
import { statusOrderSchema } from "@/lib/core/schemas";

// Порядок справочника целиком — одним запросом: перетаскивание одного статуса
// сдвигает соседей, а PATCH по статусу оставлял бы справочник в промежуточном
// состоянии между запросами.
export const PUT = withOrg(async (request, { auth }) => {
  const [body, invalid] = await parseJson(request, statusOrderSchema);
  if (invalid) return invalid;
  return NextResponse.json(await reorderStatuses(auth, body.order, { set_id: body.set_id }));
});
