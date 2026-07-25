import { NextResponse } from "next/server";
import { createClient, listClients } from "@/lib/core/clients";
import { withOrg } from "@/lib/core/context";
import { parseJson } from "@/lib/core/http";
import { clientCreateSchema } from "@/lib/core/schemas";

export const GET = withOrg(async (_request, { auth }) => {
  return NextResponse.json(await listClients(auth));
});

export const POST = withOrg(async (request, { auth }) => {
  const [body, invalid] = await parseJson(request, clientCreateSchema);
  if (invalid) return invalid;
  return NextResponse.json(await createClient(auth, body), { status: 201 });
});
