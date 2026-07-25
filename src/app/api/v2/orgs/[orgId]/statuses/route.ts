import { NextResponse } from "next/server";
import { withOrg } from "@/lib/core/context";
import { parseJson } from "@/lib/core/http";
import { createStatus, listStatuses } from "@/lib/core/orgmeta";
import { statusCreateSchema } from "@/lib/core/schemas";

export const GET = withOrg(async (_request, { auth }) => {
  return NextResponse.json(await listStatuses(auth));
});

export const POST = withOrg(async (request, { auth }) => {
  const [body, invalid] = await parseJson(request, statusCreateSchema);
  if (invalid) return invalid;
  return NextResponse.json(await createStatus(auth, body), { status: 201 });
});
