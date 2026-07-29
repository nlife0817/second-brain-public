import { NextResponse } from "next/server";
import { withOrg } from "@/lib/core/context";
import { exportOrg } from "@/lib/core/saas";

/** Полная выгрузка организации в JSON — для переноса и резервной копии. */
export const GET = withOrg(async (_request, { auth }) => {
  const data = await exportOrg(auth);
  return new NextResponse(JSON.stringify(data, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="export-${auth.orgId}.json"`,
    },
  });
});
