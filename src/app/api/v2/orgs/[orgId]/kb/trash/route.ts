import { NextResponse } from "next/server";
import { withOrg } from "@/lib/core/context";
import { listKbTrash } from "@/lib/core/kb";

export const GET = withOrg(async (_request, { auth }) => {
  return NextResponse.json(await listKbTrash(auth));
});
