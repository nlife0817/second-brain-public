import { NextResponse } from "next/server";
import { createApiToken, listApiTokens } from "@/lib/core/api-tokens";
import { withOrg } from "@/lib/core/context";
import { parseJson } from "@/lib/core/http";
import { canOrg } from "@/lib/core/policy";
import { apiTokenCreateSchema } from "@/lib/core/schemas";

/**
 * Свои токены видит каждый участник, все токены организации — тот, кто
 * управляет её составом: токен действует правами своего владельца, поэтому
 * список выпущенных ключей — часть администрирования доступа.
 */
export const GET = withOrg(async (_request, { auth }) => {
  return NextResponse.json(await listApiTokens(auth, { all: canOrg(auth, "org.members.manage") }));
});

/** Значение токена возвращается ТОЛЬКО здесь — в списке его больше нет. */
export const POST = withOrg(async (request, { auth }) => {
  const [body, invalid] = await parseJson(request, apiTokenCreateSchema);
  if (invalid) return invalid;
  return NextResponse.json(await createApiToken(auth, body), { status: 201 });
});
