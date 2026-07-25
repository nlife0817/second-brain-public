import { NextResponse } from "next/server";
import { withOrg } from "@/lib/core/context";
import { parseJson } from "@/lib/core/http";
import { createTag, listTags } from "@/lib/core/orgmeta";
import { tagCreateSchema } from "@/lib/core/schemas";

export const GET = withOrg(async (_request, { auth }) => {
  return NextResponse.json(await listTags(auth));
});

export const POST = withOrg(async (request, { auth }) => {
  const [body, invalid] = await parseJson(request, tagCreateSchema);
  if (invalid) return invalid;
  return NextResponse.json(await createTag(auth, body), { status: 201 });
});
