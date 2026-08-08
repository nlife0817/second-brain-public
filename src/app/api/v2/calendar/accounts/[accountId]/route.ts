// Отключение внешнего календаря. События и календари уносит каскад (0046):
// оставлять их значило бы показывать данные источника, доступ к которому уже
// отозван.

import { NextResponse } from "next/server";
import { disconnectAccount } from "@/lib/core/calendars";
import { withUserParams } from "@/lib/core/context";
import { isUuid, jsonError } from "@/lib/core/http";

export const DELETE = withUserParams(async (_request, user, params) => {
  if (!isUuid(params.accountId)) return jsonError(404, "Not found");
  await disconnectAccount(user.id, params.accountId);
  return NextResponse.json({ ok: true });
});
