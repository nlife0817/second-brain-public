import { NextResponse } from "next/server";
import { addClientNote } from "@/lib/core/clients";
import { withOrg } from "@/lib/core/context";
import { isUuid, jsonError, parseJson } from "@/lib/core/http";
import { clientNoteSchema } from "@/lib/core/schemas";

export const POST = withOrg(async (request, { params, auth }) => {
  const { clientId } = await params;
  if (!isUuid(clientId)) return jsonError(404, "Client not found");
  const [body, invalid] = await parseJson(request, clientNoteSchema);
  if (invalid) return invalid;
  await addClientNote(auth, clientId, body.text);
  return NextResponse.json({ ok: true }, { status: 201 });
});
