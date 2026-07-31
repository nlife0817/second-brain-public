import { NextResponse } from "next/server";
import { revokeApiToken } from "@/lib/core/api-tokens";
import { withOrg } from "@/lib/core/context";
import { isUuid, jsonError } from "@/lib/core/http";
import { canOrg } from "@/lib/core/policy";

/** Свой токен отзывает владелец, чужой — администратор организации. */
export const DELETE = withOrg(async (_request, { params, auth }) => {
  const { tokenId } = await params;
  if (!isUuid(tokenId)) return jsonError(404, "Токен не найден");
  await revokeApiToken(auth, tokenId, canOrg(auth, "org.members.manage"));
  return NextResponse.json({ ok: true });
});
