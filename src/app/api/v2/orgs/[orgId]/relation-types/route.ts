import { NextResponse } from "next/server";
import { withOrg } from "@/lib/core/context";
import { parseJson } from "@/lib/core/http";
import { createRelationType, listRelationTypes } from "@/lib/core/relations";
import { relationTypeCreateSchema } from "@/lib/core/schemas";

export const GET = withOrg(async (_request, { auth }) => {
  return NextResponse.json(await listRelationTypes(auth));
});

export const POST = withOrg(async (request, { auth }) => {
  const [body, invalid] = await parseJson(request, relationTypeCreateSchema);
  if (invalid) return invalid;
  return NextResponse.json(await createRelationType(auth, body), { status: 201 });
});
