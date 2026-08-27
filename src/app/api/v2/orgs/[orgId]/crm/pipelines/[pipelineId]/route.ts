import { NextResponse } from "next/server";
import { withOrg } from "@/lib/core/context";
import { deletePipeline, updatePipeline } from "@/lib/core/crm";
import { isUuid, jsonError, parseJson } from "@/lib/core/http";
import { pipelinePatchSchema } from "@/lib/core/schemas";

export const PATCH = withOrg(async (request, { auth, params }) => {
  const { pipelineId } = await params;
  if (!isUuid(pipelineId)) return jsonError(404, "Not found");
  const [body, invalid] = await parseJson(request, pipelinePatchSchema);
  if (invalid) return invalid;
  return NextResponse.json(await updatePipeline(auth, pipelineId, body));
});

export const DELETE = withOrg(async (request, { auth, params }) => {
  const { pipelineId } = await params;
  if (!isUuid(pipelineId)) return jsonError(404, "Not found");
  // Куда переносить сделки — параметром строки запроса: тело у DELETE
  // необязательно и до обработчика доезжает не всегда.
  const moveTo = new URL(request.url).searchParams.get("move_to");
  await deletePipeline(auth, pipelineId, moveTo);
  return NextResponse.json({ ok: true });
});
