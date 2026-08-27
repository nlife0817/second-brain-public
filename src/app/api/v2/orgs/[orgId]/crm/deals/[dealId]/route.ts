import { NextResponse } from "next/server";
import { withOrg } from "@/lib/core/context";
import { deleteDeal, getDeal, listDealHistory, updateDeal } from "@/lib/core/crm";
import { isUuid, jsonError, parseJson } from "@/lib/core/http";
import { dealPatchSchema } from "@/lib/core/schemas";

/** Карточка одним запросом: сделка плюс её история этапов. */
export const GET = withOrg(async (_request, { auth, params }) => {
  const { dealId } = await params;
  if (!isUuid(dealId)) return jsonError(404, "Not found");
  const [deal, history] = await Promise.all([
    getDeal(auth, dealId),
    listDealHistory(auth, dealId),
  ]);
  return NextResponse.json({ deal, history });
});

export const PATCH = withOrg(async (request, { auth, params }) => {
  const { dealId } = await params;
  if (!isUuid(dealId)) return jsonError(404, "Not found");
  const [body, invalid] = await parseJson(request, dealPatchSchema);
  if (invalid) return invalid;
  return NextResponse.json(await updateDeal(auth, dealId, body));
});

export const DELETE = withOrg(async (_request, { auth, params }) => {
  const { dealId } = await params;
  if (!isUuid(dealId)) return jsonError(404, "Not found");
  await deleteDeal(auth, dealId);
  return NextResponse.json({ ok: true });
});
