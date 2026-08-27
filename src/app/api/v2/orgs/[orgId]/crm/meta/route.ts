import { NextResponse } from "next/server";
import { withOrg } from "@/lib/core/context";
import { listCrmMeta } from "@/lib/core/crm";

export const GET = withOrg(async (_request, { auth }) => {
  return NextResponse.json(await listCrmMeta(auth));
});
