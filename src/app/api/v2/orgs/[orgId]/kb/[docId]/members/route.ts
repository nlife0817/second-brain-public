import { NextResponse } from "next/server";
import { withOrg } from "@/lib/core/context";
import { isUuid, jsonError, parseJson } from "@/lib/core/http";
import { listKbMembers, setKbMember } from "@/lib/core/kb";
import { kbMemberSchema } from "@/lib/core/schemas";

export const GET = withOrg(async (_request, { params, auth }) => {
  const { docId } = await params;
  if (!isUuid(docId)) return jsonError(404, "Документ не найден");
  return NextResponse.json(await listKbMembers(auth, docId));
});

/** Добавить, сменить роль или (role: null) убрать участника общего документа. */
export const PUT = withOrg(async (request, { params, auth }) => {
  const { docId } = await params;
  if (!isUuid(docId)) return jsonError(404, "Документ не найден");
  const [body, invalid] = await parseJson(request, kbMemberSchema);
  if (invalid) return invalid;
  return NextResponse.json(await setKbMember(auth, docId, body.user_id, body.role));
});
