import { NextResponse } from "next/server";
import { deleteClient, getClient, updateClient } from "@/lib/core/clients";
import { withOrg } from "@/lib/core/context";
import { isUuid, jsonError, parseJson } from "@/lib/core/http";
import { clientPatchSchema } from "@/lib/core/schemas";

export const GET = withOrg(async (_request, { params, auth }) => {
  const { clientId } = await params;
  if (!isUuid(clientId)) return jsonError(404, "Client not found");
  return NextResponse.json(await getClient(auth, clientId));
});

export const PATCH = withOrg(async (request, { params, auth }) => {
  const { clientId } = await params;
  if (!isUuid(clientId)) return jsonError(404, "Client not found");
  const [body, invalid] = await parseJson(request, clientPatchSchema);
  if (invalid) return invalid;
  return NextResponse.json(await updateClient(auth, clientId, body));
});

export const DELETE = withOrg(async (_request, { params, auth }) => {
  const { clientId } = await params;
  if (!isUuid(clientId)) return jsonError(404, "Client not found");
  await deleteClient(auth, clientId);
  return NextResponse.json({ ok: true });
});
