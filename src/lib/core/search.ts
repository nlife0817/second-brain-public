// Поиск по задачам и клиентам. Видимость фильтруется тем же policy-слоем,
// что и списки: в выдачу не должно попасть ничего из закрытых проектов.

import { prepare } from "@/lib/sql";
import { canOrg, effectiveProjectRole } from "./policy";
import type { AuthContext, PolicyProject } from "./types";

export interface SearchHit {
  type: "task" | "client" | "project";
  id: string;
  title: string;
  subtitle: string | null;
  completed: boolean;
  /**
   * Задача уже чья-то подзадача. Нужно тем, кто выбирает по поиску родителя:
   * привязка молча разорвала бы прежнюю связь, а её видно только из карточки.
   * Название родителя не отдаём — доступ к задаче не означает доступа к нему
   * (то же правило, что в `getParentBrief`). У клиентов и проектов — `false`.
   */
  has_parent: boolean;
}

export async function search(ctx: AuthContext, query: string, limit = 20): Promise<SearchHit[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const like = `%${q}%`;

  // Кандидаты по задачам берём с запасом: часть отсечёт проверка видимости.
  const taskRows = await prepare<{
    id: string;
    title: string;
    completed_at: string | null;
    created_by: string | null;
    parent_task_id: string | null;
    project_ids: string[] | null;
    assignee_ids: string[] | null;
  }>(
    `SELECT t.id, t.title, t.completed_at, t.created_by, t.parent_task_id,
            (SELECT array_agg(tp.project_id::text) FROM core.task_projects tp WHERE tp.task_id = t.id) AS project_ids,
            (SELECT array_agg(ta.user_id::text) FROM core.task_assignees ta WHERE ta.task_id = t.id) AS assignee_ids
     FROM core.tasks t
     WHERE t.org_id = ? AND t.title ILIKE ?
     ORDER BY t.completed_at NULLS FIRST, similarity(t.title, ?) DESC, t.updated_at DESC
     LIMIT ?`,
  ).all(ctx.orgId, like, q, limit * 4);

  const projectIds = [...new Set(taskRows.flatMap((r) => r.project_ids ?? []))];
  const projectMap = new Map<string, PolicyProject>();
  if (projectIds.length > 0) {
    const ph = projectIds.map(() => "?").join(",");
    const projects = await prepare<PolicyProject & { name: string }>(
      `SELECT id, org_id, default_role, name FROM core.projects WHERE id IN (${ph})`,
    ).all(projectIds);
    for (const p of projects) projectMap.set(p.id, p);
  }

  const hits: SearchHit[] = [];
  for (const row of taskRows) {
    const rowProjects = (row.project_ids ?? []).map((id) => projectMap.get(id)).filter(Boolean) as PolicyProject[];
    const visibleProject = rowProjects.find((p) => effectiveProjectRole(ctx, p) !== null);
    // Задача видна либо через проект, либо как своя (создатель/исполнитель).
    const isMine =
      row.created_by === ctx.user.id || (row.assignee_ids ?? []).includes(ctx.user.id);
    if (!visibleProject && !isMine) continue;
    hits.push({
      type: "task",
      id: row.id,
      title: row.title,
      subtitle: visibleProject
        ? ((projectMap.get(visibleProject.id) as { name?: string })?.name ?? null)
        : "Личная задача",
      completed: !!row.completed_at,
      has_parent: !!row.parent_task_id,
    });
    if (hits.length >= limit) break;
  }

  if (canOrg(ctx, "clients.view") && hits.length < limit) {
    const clients = await prepare<{ id: string; name: string; status_name: string | null }>(
      `SELECT c.id, c.name, s.name AS status_name
       FROM core.clients c LEFT JOIN core.client_statuses s ON s.id = c.status_id
       WHERE c.org_id = ? AND c.name ILIKE ?
       ORDER BY similarity(c.name, ?) DESC
       LIMIT ?`,
    ).all(ctx.orgId, like, q, limit - hits.length);
    for (const c of clients) {
      hits.push({
        type: "client",
        id: c.id,
        title: c.name,
        subtitle: c.status_name,
        completed: false,
        has_parent: false,
      });
    }
  }

  return hits;
}
