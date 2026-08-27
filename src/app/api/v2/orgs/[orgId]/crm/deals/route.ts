import { NextResponse } from "next/server";
import { withOrg } from "@/lib/core/context";
import { createDeal, listClientDeals, listDeals } from "@/lib/core/crm";
import { parseJson } from "@/lib/core/http";
import { dealCreateSchema } from "@/lib/core/schemas";

export const GET = withOrg(async (request, { auth }) => {
  const params = new URL(request.url).searchParams;
  // Карточка клиента показывает его сделки — тот же список, другой срез.
  const clientId = params.get("client_id");
  if (clientId) return NextResponse.json(await listClientDeals(auth, clientId));
  const pipelineId = params.get("pipeline_id") ?? undefined;
  return NextResponse.json(await listDeals(auth, { pipelineId }));
});

export const POST = withOrg(async (request, { auth }) => {
  const [body, invalid] = await parseJson(request, dealCreateSchema);
  if (invalid) return invalid;
  return NextResponse.json(await createDeal(auth, body), { status: 201 });
});
