// Серверная сборка состояния оболочки v2.
//
// Раньше браузер добывал это же семью запросами подряд: сначала /me (без него
// неизвестен orgId), потом шесть справочников, и только потом страница начинала
// грузить своё. Три последовательные волны, и каждый запрос заново поднимал
// сессию, членство и роли проектов — около 25 запросов к БД на одну авторизацию.
//
// Здесь всё то же собирается за один серверный проход: пользователь и контекст
// организации резолвятся один раз (`cache` в context.ts), справочники идут
// параллельно, а результат уезжает в HTML вместе с разметкой.

import { cache } from "react";
import { cookies } from "next/headers";
import { getCoreUser, getOrgAuth } from "./context";
import { listOrgMembers, listUserOrgs } from "./identity";
import { listProjects } from "./projects";
import { listStatuses, listTags } from "./orgmeta";
import { listFields } from "./fields";
import { unreadNotificationCount } from "./events";
import { canOrg } from "./policy";
import { ACTIVE_ORG_COOKIE } from "./keys";
import type {
  AuthContext,
  CoreTag,
  CustomField,
  OrgMemberWithUser,
  OrgRole,
  OrgSummary,
  ProjectWithMeta,
  TaskStatus,
  UserBrief,
} from "./types";

/** Справочники организации — то, что раньше отдавали шесть отдельных ручек. */
export interface OrgMeta {
  projects: ProjectWithMeta[];
  statuses: TaskStatus[];
  tags: CoreTag[];
  members: OrgMemberWithUser[];
  fields: CustomField[];
  unreadCount: number;
}

export interface V2Bootstrap extends OrgMeta {
  me: UserBrief;
  orgs: OrgSummary[];
  orgId: string;
  orgName: string;
  orgRole: OrgRole;
}

export type V2BootstrapResult =
  /** Всё на месте: оболочку и страницу можно рендерить целиком. */
  | { state: "ok"; data: V2Bootstrap }
  /** Пользователь есть, организации нет — экран создания организации. */
  | { state: "onboarding"; me: UserBrief }
  /** Сессии нет либо она разъехалась с базой — оболочка покажет ошибку. */
  | { state: "anonymous" };

function toBrief(user: { id: string; email: string; name: string; avatar_url: string | null }): UserBrief {
  return { id: user.id, email: user.email, name: user.name, avatar_url: user.avatar_url };
}

/**
 * Справочники организации одним параллельным пакетом.
 *
 * Участники доступны не всякой роли (гость их не видит) — отказ policy здесь
 * означает пустой список, а не ошибку экрана. Остальные справочники читают
 * данные, на которые право уже подтверждено членством.
 */
export const loadOrgMeta = cache(async (auth: AuthContext): Promise<OrgMeta> => {
  const [projects, statuses, tags, members, fields, unreadCount] = await Promise.all([
    listProjects(auth),
    listStatuses(auth),
    listTags(auth),
    canOrg(auth, "org.members.view") ? listOrgMembers(auth.orgId) : Promise.resolve([]),
    listFields(auth),
    unreadNotificationCount(auth.orgId, auth.user.id),
  ]);
  return { projects, statuses, tags, members, fields, unreadCount };
});

/**
 * Контекст активной организации для серверного рендера экрана v2.
 *
 * Возвращает null, когда рендерить нечего (нет сессии или нет организаций) —
 * страницы в таком случае отдают пустую разметку, а решение показать
 * онбординг или ошибку принимает оболочка по результату `loadV2Bootstrap`.
 */
export const getActiveOrgAuth = cache(async (): Promise<AuthContext | null> => {
  const user = await getCoreUser();
  if (!user) return null;
  const orgs = await listUserOrgs(user.id);
  if (orgs.length === 0) return null;
  const saved = (await cookies()).get(ACTIVE_ORG_COOKIE)?.value;
  // Cookie могла остаться от организации, из которой человека уже исключили.
  const org = orgs.find((o) => o.id === saved) ?? orgs[0];
  return getOrgAuth(org.id);
});

/** Полное состояние оболочки v2 для серверного рендера. */
export const loadV2Bootstrap = cache(async (): Promise<V2BootstrapResult> => {
  const user = await getCoreUser();
  if (!user) return { state: "anonymous" };

  const orgs = await listUserOrgs(user.id);
  if (orgs.length === 0) return { state: "onboarding", me: toBrief(user) };

  const auth = await getActiveOrgAuth();
  // Членство пропало между выборкой организаций и резолвом контекста —
  // редкость, но обрабатываем как отсутствие доступа, а не как краш рендера.
  if (!auth) return { state: "anonymous" };

  const org = orgs.find((o) => o.id === auth.orgId) ?? orgs[0];
  const meta = await loadOrgMeta(auth);

  return {
    state: "ok",
    data: {
      me: toBrief(user),
      orgs,
      orgId: auth.orgId,
      orgName: org.name,
      orgRole: auth.orgRole,
      ...meta,
    },
  };
});
