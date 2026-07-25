import { NextResponse } from "next/server";
import { withOrg } from "@/lib/core/context";
import { parseJson } from "@/lib/core/http";
import { createWebhook, listWebhooks } from "@/lib/core/saas";
import { webhookCreateSchema } from "@/lib/core/schemas";

export const GET = withOrg(async (_request, { auth }) => {
  return NextResponse.json(await listWebhooks(auth));
});

/** Секрет возвращается ТОЛЬКО здесь — в списке его нет. */
export const POST = withOrg(async (request, { auth }) => {
  const [body, invalid] = await parseJson(request, webhookCreateSchema);
  if (invalid) return invalid;
  return NextResponse.json(await createWebhook(auth, body), { status: 201 });
});
