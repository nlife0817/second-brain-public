import { NextResponse } from "next/server";
import { withOrg } from "@/lib/core/context";
import { createLostReason } from "@/lib/core/crm";
import { parseJson } from "@/lib/core/http";
import { lostReasonCreateSchema } from "@/lib/core/schemas";

export const POST = withOrg(async (request, { auth }) => {
  const [body, invalid] = await parseJson(request, lostReasonCreateSchema);
  if (invalid) return invalid;
  return NextResponse.json(await createLostReason(auth, body), { status: 201 });
});
