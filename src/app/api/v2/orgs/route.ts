import { NextResponse } from "next/server";
import { withUser } from "@/lib/core/context";
import { parseJson } from "@/lib/core/http";
import { createOrganization, listUserOrgs } from "@/lib/core/identity";
import { orgCreateSchema } from "@/lib/core/schemas";

export const GET = withUser(async (_request, user) => {
  return NextResponse.json(await listUserOrgs(user.id));
});

export const POST = withUser(async (request, user) => {
  const [body, invalid] = await parseJson(request, orgCreateSchema);
  if (invalid) return invalid;
  const org = await createOrganization(body.name, user.id);
  return NextResponse.json(org, { status: 201 });
});
