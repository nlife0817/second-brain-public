import { NextResponse } from "next/server";
import { withOrg } from "@/lib/core/context";
import { createStage, reorderStages } from "@/lib/core/crm";
import { isUuid, jsonError, parseJson } from "@/lib/core/http";
import { stageCreateSchema, stageOrderSchema } from "@/lib/core/schemas";

export const POST = withOrg(async (request, { auth, params }) => {
  const { pipelineId } = await params;
  if (!isUuid(pipelineId)) return jsonError(404, "Not found");
  const [body, invalid] = await parseJson(request, stageCreateSchema);
  if (invalid) return invalid;
  return NextResponse.json(await createStage(auth, pipelineId, body), { status: 201 });
});

/** Порядок этапов приходит целиком — частичный список увёл бы неупомянутые в начало. */
export const PUT = withOrg(async (request, { auth, params }) => {
  const { pipelineId } = await params;
  if (!isUuid(pipelineId)) return jsonError(404, "Not found");
  const [body, invalid] = await parseJson(request, stageOrderSchema);
  if (invalid) return invalid;
  return NextResponse.json(await reorderStages(auth, pipelineId, body.stage_ids));
});
