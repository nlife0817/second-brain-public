import { NextResponse } from "next/server";
import { withOrg } from "@/lib/core/context";
import { createPipeline } from "@/lib/core/crm";
import { parseJson } from "@/lib/core/http";
import { pipelineCreateSchema } from "@/lib/core/schemas";

export const POST = withOrg(async (request, { auth }) => {
  const [body, invalid] = await parseJson(request, pipelineCreateSchema);
  if (invalid) return invalid;
  return NextResponse.json(await createPipeline(auth, body), { status: 201 });
});
