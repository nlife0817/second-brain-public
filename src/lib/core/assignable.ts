// Кому можно назначить задачу.
//
// Закрытый проект (`default_role === null`) виден только явным участникам, а
// назначение само по себе открывает задачу исполнителю. Поэтому в задачах
// закрытого проекта выбор ограничен его участниками — и в интерфейсе тоже, а не
// только отказом сервера (`assertAssigneesInClosedProjects` в tasks.ts).
//
// Открытый проект ничего не ограничивает: там задачу видит вся организация.

import type { OrgMemberWithUser, ProjectWithMeta } from "./types";

type ProjectSource = ProjectWithMeta[] | Map<string, ProjectWithMeta>;

function lookup(projects: ProjectSource): (id: string) => ProjectWithMeta | undefined {
  if (projects instanceof Map) return (id) => projects.get(id);
  return (id) => projects.find((p) => p.id === id);
}

/**
 * Кого пускают в исполнители: пересечение участников по всем закрытым проектам
 * задачи. `null` — ограничений нет.
 *
 * Незнакомый проект (архивный, недоступный) пропускаем: сузить список по
 * данным, которых у экрана нет, всё равно нельзя, а сервер проверит своё.
 */
export function assignableUserIds(
  projectIds: string[],
  projects: ProjectSource,
): Set<string> | null {
  const find = lookup(projects);
  const closed: string[][] = [];
  for (const id of projectIds) {
    const members = find(id)?.member_ids;
    if (members) closed.push(members);
  }
  if (closed.length === 0) return null;
  // Задача в двух закрытых проектах сразу доступна только тем, кто есть в обоих.
  return closed.reduce(
    (allowed, members) => new Set(members.filter((u) => allowed.has(u))),
    new Set(closed[0]),
  );
}

export interface AssigneeChoice {
  /** Что показывать в выпадающем списке. */
  members: OrgMemberWithUser[];
  /** Названия закрытых проектов, сузивших выбор; пусто — ограничений не было. */
  restrictedBy: string[];
}

/**
 * Готовый выбор исполнителей для интерфейса.
 *
 * `keep` — те, кто уже назначен: их оставляем в списке, даже если состав
 * проекта с тех пор изменился. Иначе стороннего исполнителя нечем было бы снять.
 */
export function assigneeChoice(
  members: OrgMemberWithUser[],
  projects: ProjectSource,
  projectIds: string[],
  keep: Iterable<string> = [],
): AssigneeChoice {
  const allowed = assignableUserIds(projectIds, projects);
  if (!allowed) return { members, restrictedBy: [] };
  const kept = new Set(keep);
  const find = lookup(projects);
  return {
    members: members.filter((m) => allowed.has(m.user_id) || kept.has(m.user_id)),
    restrictedBy: projectIds
      .map((id) => find(id))
      .filter((p): p is ProjectWithMeta => !!p && p.member_ids !== null)
      .map((p) => p.name),
  };
}
