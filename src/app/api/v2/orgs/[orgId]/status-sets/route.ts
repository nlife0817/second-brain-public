import { NextResponse } from "next/server";
import { withOrg } from "@/lib/core/context";
import { parseJson } from "@/lib/core/http";
import { createStatusSet, listStatusSets } from "@/lib/core/orgmeta";
import { statusSetCreateSchema } from "@/lib/core/schemas";

export const GET = withOrg(async (_request, { auth }) => {
  return NextResponse.json(await listStatusSets(auth));
});

export const POST = withOrg(async (request, { auth }) => {
  const [body, invalid] = await parseJson(request, statusSetCreateSchema);
  if (invalid) return invalid;
  return NextResponse.json(await createStatusSet(auth, body), { status: 201 });
});
