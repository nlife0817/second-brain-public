import { NextResponse } from "next/server";
import { withOrg } from "@/lib/core/context";
import { createLeadSource } from "@/lib/core/crm";
import { parseJson } from "@/lib/core/http";
import { leadSourceCreateSchema } from "@/lib/core/schemas";

export const POST = withOrg(async (request, { auth }) => {
  const [body, invalid] = await parseJson(request, leadSourceCreateSchema);
  if (invalid) return invalid;
  return NextResponse.json(await createLeadSource(auth, body), { status: 201 });
});
