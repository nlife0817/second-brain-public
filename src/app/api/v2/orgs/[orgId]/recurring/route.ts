import { NextResponse } from "next/server";
import { withOrg } from "@/lib/core/context";
import { parseJson } from "@/lib/core/http";
import { createRule, listRules } from "@/lib/core/recurring";
import { recurringCreateSchema } from "@/lib/core/schemas";

export const GET = withOrg(async (_request, { auth }) => {
  return NextResponse.json(await listRules(auth));
});

export const POST = withOrg(async (request, { auth }) => {
  const [body, invalid] = await parseJson(request, recurringCreateSchema);
  if (invalid) return invalid;
  return NextResponse.json(await createRule(auth, body), { status: 201 });
});
