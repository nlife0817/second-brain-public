// Разрешение пользователя v2 и обёртка withOrg для роутов /api/v2/orgs/[orgId]/*.
//
// Порядок разрешения пользователя:
//   1) dev-байпас (NODE_ENV !== production + DEV_USER_EMAIL) — как в v1;
//   2) Supabase-сессия → core.users по auth_user_id, затем по email (с бэкфиллом);
//   3) переходное авто-провижининг: email есть в whitelist public.users →
//      создаём core.users + членство в бутстрап-организации по маппингу ролей.

import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/supabase/claims";
import { prepare } from "@/lib/sql";
import { dispatchPendingPush } from "./push";
import { isUuid, jsonError, toHttpError } from "./http";
import {
  addMember,
  createUser,
  getFirstOrganization,
  getMembershipRole,
  getUserByAuthId,
  getUserByEmail,
  linkAuthUser,
} from "./identity";
import type { AuthContext, CoreUser, OrgRole, ProjectRole } from "./types";
import { ORG_ROLE_RANK } from "./types";

async function provisionFromWhitelist(
  email: string,
  authUserId: string | null,
  fullName: string,
): Promise<CoreUser | null> {
  const legacy = await prepare<{ email: string; role: string; name: string }>(
    `SELECT email, role, name FROM public.users WHERE email = ?`,
  ).get(email);
  if (!legacy) return null;

  const user = await createUser({
    email,
    name: legacy.name || fullName,
    authUserId,
  });
  const org = await getFirstOrganization();
  if (org) {
    const existing = await getMembershipRole(org.id, user.id);
    if (!existing) {
      await addMember(org.id, user.id, legacy.role === "admin" ? "admin" : "member");
    }
  }
  return user;
}

/** Текущий пользователь v2 или null (неавторизован / нет доступа). */
export async function getCoreUser(): Promise<CoreUser | null> {
  const devEmail = process.env.DEV_USER_EMAIL?.toLowerCase().trim();
  if (process.env.NODE_ENV !== "production" && devEmail) {
    const existing = await getUserByEmail(devEmail);
    if (existing) return existing;
    const provisioned = await provisionFromWhitelist(devEmail, null, "Dev User");
    if (provisioned) return provisioned;
    return createUser({ email: devEmail, name: "Dev User" });
  }

  const supabase = await createSupabaseServerClient();
  const user = await getSessionUser(supabase);
  if (!user?.email) return null;

  const email = user.email.toLowerCase().trim();

  const byAuthId = await getUserByAuthId(user.id);
  if (byAuthId) return byAuthId;

  const byEmail = await getUserByEmail(email);
  if (byEmail) {
    await linkAuthUser(byEmail.id, user.id);
    return { ...byEmail, auth_user_id: user.id };
  }

  const provisioned = await provisionFromWhitelist(email, user.id, user.fullName);
  if (provisioned) return provisioned;

  // Первый вход человека, которого нет ни в v1-whitelist, ни в core.users:
  // заводим запись identity. Доступ она НЕ даёт — его даёт только членство
  // в организации (org_members), которое появляется при принятии приглашения.
  return createUser({ email, name: user.fullName, authUserId: user.id });
}

async function loadProjectRoles(orgId: string, userId: string): Promise<Map<string, ProjectRole>> {
  const rows = await prepare<{ project_id: string; role: ProjectRole }>(
    `SELECT pm.project_id, pm.role
     FROM core.project_members pm
     JOIN core.projects p ON p.id = pm.project_id
     WHERE p.org_id = ? AND pm.user_id = ?`,
  ).all(orgId, userId);
  return new Map(rows.map((r) => [r.project_id, r.role]));
}

/** Собирает AuthContext для организации или отвечает причиной отказа. */
export async function resolveOrgContext(
  orgId: string,
): Promise<{ auth: AuthContext } | { failure: NextResponse }> {
  const user = await getCoreUser();
  if (!user) return { failure: jsonError(401, "Unauthorized") };
  if (!isUuid(orgId)) return { failure: jsonError(404, "Not found") };
  const orgRole = await getMembershipRole(orgId, user.id);
  // 404, а не 403: не подтверждаем существование чужой организации.
  if (!orgRole) return { failure: jsonError(404, "Not found") };
  const projectRoles = await loadProjectRoles(orgId, user.id);
  return { auth: { user, orgId, orgRole, projectRoles } };
}

/**
 * Мутация могла разложить уведомления (fan-out в той же транзакции) — шлём
 * push сразу после ответа, не дожидаясь 10-минутного cron-тика. Диспетчер
 * идемпотентен и дёшев на пустой очереди, поэтому зовём после любой мутации.
 */
function schedulePushDispatch(method: string, status: number): void {
  if (method === "GET" || method === "HEAD" || status >= 400) return;
  after(async () => {
    try {
      await dispatchPendingPush();
    } catch (err) {
      console.error("[v2/push] мгновенная отправка не удалась:", err);
    }
  });
}

type OrgRouteContext = {
  params: Promise<Record<string, string>>;
  auth: AuthContext;
};

type OrgHandler = (request: NextRequest, context: OrgRouteContext) => Promise<NextResponse>;

type RouteHandler = (
  request: NextRequest,
  context: { params: Promise<Record<string, string>> },
) => Promise<NextResponse>;

/**
 * Обёртка роутов /api/v2/orgs/[orgId]/**: аутентификация, членство, минимальная
 * org-роль. Доменные и policy-ошибки конвертируются в HTTP в одном месте.
 */
export function withOrg(handler: OrgHandler, opts?: { minOrgRole?: OrgRole }): RouteHandler {
  return async (request, context) => {
    try {
      const params = await context.params;
      const orgId = params.orgId;
      if (!orgId) return jsonError(400, "orgId is required");
      const resolved = await resolveOrgContext(orgId);
      if ("failure" in resolved) return resolved.failure;
      if (opts?.minOrgRole) {
        if (ORG_ROLE_RANK[resolved.auth.orgRole] < ORG_ROLE_RANK[opts.minOrgRole]) {
          return jsonError(403, "Forbidden");
        }
      }
      const response = await handler(request, { params: context.params, auth: resolved.auth });
      schedulePushDispatch(request.method, response.status);
      return response;
    } catch (err) {
      return toHttpError(err);
    }
  };
}

/** Обёртка для роутов v2 вне контекста организации (/api/v2/me, /api/v2/orgs). */
export function withUser(
  handler: (request: NextRequest, user: CoreUser) => Promise<NextResponse>,
): (request: NextRequest) => Promise<NextResponse> {
  return async (request) => {
    try {
      const user = await getCoreUser();
      if (!user) return jsonError(401, "Unauthorized");
      // Принятие приглашения (withUser) тоже раскладывает уведомления.
      const response = await handler(request, user);
      schedulePushDispatch(request.method, response.status);
      return response;
    } catch (err) {
      return toHttpError(err);
    }
  };
}
