import { NextResponse } from "next/server";
import {
  createClientStatus,
  createCrmSystem,
  listClientStatuses,
  listCrmSystems,
} from "@/lib/core/clients";
import { withOrg } from "@/lib/core/context";
import { parseJson } from "@/lib/core/http";
import { clientMetaCreateSchema } from "@/lib/core/schemas";

/** Справочники CRM: статусы клиентов и CRM-системы одним запросом. */
export const GET = withOrg(async (_request, { auth }) => {
  const [statuses, crm_systems] = await Promise.all([
    listClientStatuses(auth),
    listCrmSystems(auth),
  ]);
  return NextResponse.json({ statuses, crm_systems });
});

export const POST = withOrg(async (request, { auth }) => {
  const [body, invalid] = await parseJson(request, clientMetaCreateSchema);
  if (invalid) return invalid;
  if (body.kind === "status") {
    return NextResponse.json(await createClientStatus(auth, { name: body.name, color: body.color }), {
      status: 201,
    });
  }
  return NextResponse.json(await createCrmSystem(auth, body.name), { status: 201 });
});
