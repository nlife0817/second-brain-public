// Разрешение пользователя v2 и обёртка withOrg для роутов /api/v2/orgs/[orgId]/*.
//
// Порядок разрешения пользователя:
//   1) dev-байпас (NODE_ENV !== production + DEV_USER_EMAIL);
//   2) сессия → core.users по email;
//   3) первый вход незнакомого человека — заводим identity без доступа.
//      Доступ даёт только членство в организации, то есть приглашение.
//
// Почему по email, а не по id из сессии: cookie, выданные до перехода на пароли,
// несут в этом поле числовой `sub` от Google, и живут они 30 дней. Пока они не
// истекли, единственный общий ключ — email; он же уникален в core.users.
// Колонка auth_user_id (uuid от Supabase Auth) остаётся в базе как след первой
// системы входа и никем не читается.

import { cache } from "react";
import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { prepare } from "@/lib/sql";
import { dispatchPendingNotifications } from "./push";
import { isUuid, jsonError, toHttpError } from "./http";
import {
  createUser,
  getMembershipRole,
  getUserByEmail,
} from "./identity";
import type { AuthContext, CoreUser, OrgRole, ProjectRole } from "./types";
import { ORG_ROLE_RANK } from "./types";

/**
 * Текущий пользователь или null (неавторизован / нет доступа).
 *
 * Не вызывать напрямую из кода, который может отработать несколько раз за один
 * запрос — для этого есть мемоизированный `getCoreUser` ниже.
 */
async function resolveCoreUser(): Promise<CoreUser | null> {
  const devEmail = process.env.DEV_USER_EMAIL?.toLowerCase().trim();
  if (process.env.NODE_ENV !== "production" && devEmail) {
    const existing = await getUserByEmail(devEmail);
    if (existing) return existing;
    return createUser({ email: devEmail, name: "Dev User" });
  }

  const user = await getSessionUser();
  if (!user?.email) return null;

  const email = user.email.toLowerCase().trim();

  const byEmail = await getUserByEmail(email);
  if (byEmail) return byEmail;

  // Подписанная cookie на адрес, которого нет в core.users. Штатно так не
  // бывает — учётку заводит установка пароля, — но остаётся возможным с cookie,
  // выданной до перехода на пароли. Заводим запись identity: доступ она НЕ даёт,
  // его даёт только членство в организации (org_members).
  return createUser({ email, name: user.fullName });
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

/**
 * Пользователь запроса. `cache` из React мемоизирует результат на время одного
 * запроса: серверный рендер экрана v2 собирает разом оболочку и данные страницы
 * и без этого резолвил бы пользователя (сессия + запросы к `core.users`) по разу
 * на каждый источник данных.
 */
export const getCoreUser = cache(resolveCoreUser);

/**
 * AuthContext организации или null. Мемоизирован по той же причине, что и
 * `getCoreUser`: членство и роли проектов — два запроса к БД, а за один рендер
 * контекст нужен и оболочке, и странице.
 */
export const getOrgAuth = cache(async (orgId: string): Promise<AuthContext | null> => {
  const user = await getCoreUser();
  if (!user) return null;
  if (!isUuid(orgId)) return null;
  const orgRole = await getMembershipRole(orgId, user.id);
  if (!orgRole) return null;
  const projectRoles = await loadProjectRoles(orgId, user.id);
  return { user, orgId, orgRole, projectRoles };
});

/** Собирает AuthContext для организации или отвечает причиной отказа. */
export async function resolveOrgContext(
  orgId: string,
): Promise<{ auth: AuthContext } | { failure: NextResponse }> {
  const user = await getCoreUser();
  if (!user) return { failure: jsonError(401, "Unauthorized") };
  const auth = await getOrgAuth(orgId);
  // 404, а не 403: не подтверждаем существование чужой организации.
  if (!auth) return { failure: jsonError(404, "Not found") };
  return { auth };
}

/**
 * Мутация могла разложить уведомления (fan-out в той же транзакции) — шлём их
 * сразу после ответа, не дожидаясь 10-минутного cron-тика. Диспетчер
 * идемпотентен и дёшев на пустой очереди, поэтому зовём после любой мутации;
 * он же обслуживает оба канала — push и телеграм.
 */
function scheduleNotificationDispatch(method: string, status: number): void {
  if (method === "GET" || method === "HEAD" || status >= 400) return;
  after(async () => {
    try {
      await dispatchPendingNotifications();
    } catch (err) {
      console.error("[v2/notifications] мгновенная отправка не удалась:", err);
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
      scheduleNotificationDispatch(request.method, response.status);
      return response;
    } catch (err) {
      return toHttpError(err);
    }
  };
}

/**
 * То же, что `withUser`, но для роутов с параметром пути — например
 * `/api/v2/calendar/calendars/[calendarId]`. Отдельная обёртка, а не третий
 * аргумент у `withUser`: у того возвращаемая функция принимает только запрос, и
 * добавить ей контекст значило бы задеть каждый существующий роут пользователя
 * ради нового.
 *
 * Организации здесь нет вовсе: подключённые календари принадлежат пользователю
 * (миграция 0046), и владение проверяет доменный слой.
 */
export function withUserParams(
  handler: (
    request: NextRequest,
    user: CoreUser,
    params: Record<string, string>,
  ) => Promise<NextResponse>,
): RouteHandler {
  return async (request, context) => {
    try {
      const user = await getCoreUser();
      if (!user) return jsonError(401, "Unauthorized");
      const response = await handler(request, user, await context.params);
      scheduleNotificationDispatch(request.method, response.status);
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
      scheduleNotificationDispatch(request.method, response.status);
      return response;
    } catch (err) {
      return toHttpError(err);
    }
  };
}
