// Связи между сущностями: задача ↔ задача, задача ↔ клиент, задача ↔ проект.
// Таблицы core.relations / core.relation_types появились в миграции 0026, но
// доменного слоя у них не было — здесь он и живёт.
//
// Связь — канал, который ссылается на сущности в обход обычных проверок, а
// значит обязан фильтровать видимость сам (правило 7 в CLAUDE.md ядра):
// иначе через список связей утекают названия чужих задач и приватных проектов.

import { prepare } from "@/lib/sql";
import { DomainError } from "./http";
import { assertOrg, canOrg, effectiveProjectRole, PolicyError } from "./policy";
import { filterVisibleTaskIds, requireTaskAccess } from "./tasks";
import type { AuthContext, PolicyProject, RelationEntityType, RelationType, RelationWithTarget } from "./types";

// --- Типы связей ------------------------------------------------------------------

export async function listRelationTypes(ctx: AuthContext): Promise<RelationType[]> {
  return prepare<RelationType>(
    `SELECT id, org_id, name, color, icon, position FROM core.relation_types
     WHERE org_id = ? ORDER BY position, name`,
  ).all(ctx.orgId);
}

export async function createRelationType(
  ctx: AuthContext,
  input: { name: string; color?: string; icon?: string },
): Promise<RelationType> {
  // Справочник org-уровня — там же, где теги и статусы.
  assertOrg(ctx, "tags.manage");
  const row = await prepare<RelationType>(
    `INSERT INTO core.relation_types (org_id, name, color, icon, position)
     VALUES (?, ?, COALESCE(?, '#6b7280'), COALESCE(?, 'Link'),
             COALESCE((SELECT max(position) + 1 FROM core.relation_types WHERE org_id = ?), 1))
     ON CONFLICT (org_id, name) DO UPDATE SET color = excluded.color, icon = excluded.icon
     RETURNING id, org_id, name, color, icon, position`,
  ).get(ctx.orgId, input.name.trim(), input.color ?? null, input.icon ?? null, ctx.orgId);
  if (!row) throw new DomainError(500, "Relation type was not created");
  return row;
}

export async function updateRelationType(
  ctx: AuthContext,
  id: string,
  patch: { name?: string; color?: string; icon?: string; position?: number },
): Promise<RelationType> {
  assertOrg(ctx, "tags.manage");
  const sets: string[] = [];
  const params: unknown[] = [];
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    sets.push(`${key} = ?`);
    params.push(typeof value === "string" ? value.trim() : value);
  }
  if (sets.length === 0) throw new DomainError(422, "Empty patch");
  const row = await prepare<RelationType>(
    `UPDATE core.relation_types SET ${sets.join(", ")} WHERE id = ? AND org_id = ?
     RETURNING id, org_id, name, color, icon, position`,
  ).get(...params, id, ctx.orgId);
  if (!row) throw new DomainError(404, "Relation type not found");
  return row;
}

export async function deleteRelationType(ctx: AuthContext, id: string): Promise<void> {
  assertOrg(ctx, "tags.manage");
  // relation_type_id → set null: сами связи переживают удаление типа.
  await prepare(`DELETE FROM core.relation_types WHERE id = ? AND org_id = ?`).run(id, ctx.orgId);
}

// --- Связи ---------------------------------------------------------------------------

interface RawRelation {
  id: string;
  org_id: string;
  source_type: RelationEntityType;
  source_id: string;
  target_type: RelationEntityType;
  target_id: string;
  relation_type_id: string | null;
  created_by: string | null;
  created_at: string;
}

/** Доступ к «якорю» связи — тому объекту, из карточки которого её смотрят. */
async function requireEntity(
  ctx: AuthContext,
  type: RelationEntityType,
  id: string,
  level: "view" | "edit",
): Promise<void> {
  if (type === "task") {
    await requireTaskAccess(ctx, id, level === "edit" ? "edit" : "view");
    return;
  }
  if (type === "client") {
    assertOrg(ctx, level === "edit" ? "clients.manage" : "clients.view");
    const row = await prepare(`SELECT 1 FROM core.clients WHERE id = ? AND org_id = ?`).get(id, ctx.orgId);
    if (!row) throw new DomainError(404, "Client not found");
    return;
  }
  const project = await prepare<PolicyProject>(
    `SELECT id, org_id, visibility FROM core.projects WHERE id = ? AND org_id = ?`,
  ).get(id, ctx.orgId);
  // 404, а не 403: существование чужого приватного проекта не подтверждаем.
  if (!project) throw new DomainError(404, "Project not found");
  const role = effectiveProjectRole(ctx, project);
  if (!role) throw new DomainError(404, "Project not found");
  if (level === "edit" && role === "viewer") throw new PolicyError("project.update");
}

/**
 * Отсеивает связи, чья «дальняя» сторона недоступна: задачи — по правам на
 * задачу, клиенты — по доступу к CRM, проекты — по видимости проекта.
 */
async function keepVisible(ctx: AuthContext, rows: RawRelation[], anchorId: string): Promise<RawRelation[]> {
  const far = (r: RawRelation) =>
    r.source_id === anchorId
      ? { type: r.target_type, id: r.target_id }
      : { type: r.source_type, id: r.source_id };

  const taskIds = [...new Set(rows.filter((r) => far(r).type === "task").map((r) => far(r).id))];
  const projectIds = [...new Set(rows.filter((r) => far(r).type === "project").map((r) => far(r).id))];

  const [visibleTasks, projectRows] = await Promise.all([
    filterVisibleTaskIds(ctx, taskIds),
    projectIds.length
      ? prepare<PolicyProject>(
          `SELECT id, org_id, visibility FROM core.projects
           WHERE org_id = ? AND id IN (${projectIds.map(() => "?").join(",")})`,
        ).all(ctx.orgId, projectIds)
      : Promise.resolve([]),
  ]);
  const visibleProjects = new Set(
    projectRows.filter((p) => effectiveProjectRole(ctx, p) !== null).map((p) => p.id),
  );
  const clientsVisible = canOrg(ctx, "clients.view");

  return rows.filter((r) => {
    const { type, id } = far(r);
    if (type === "task") return visibleTasks.has(id);
    if (type === "project") return visibleProjects.has(id);
    return clientsVisible;
  });
}

/** Подписи «дальних» сторон: заголовок задачи, имя клиента или проекта. */
async function resolveTitles(
  rows: RawRelation[],
  anchorId: string,
): Promise<Map<string, { title: string; color: string | null }>> {
  const wanted = rows.map((r) =>
    r.source_id === anchorId
      ? { type: r.target_type, id: r.target_id }
      : { type: r.source_type, id: r.source_id },
  );
  const byType = (type: RelationEntityType) => [
    ...new Set(wanted.filter((w) => w.type === type).map((w) => w.id)),
  ];
  const taskIds = byType("task");
  const clientIds = byType("client");
  const projectIds = byType("project");

  const [tasks, clients, projects] = await Promise.all([
    taskIds.length
      ? prepare<{ id: string; title: string }>(
          `SELECT id, title FROM core.tasks WHERE id IN (${taskIds.map(() => "?").join(",")})`,
        ).all(taskIds)
      : Promise.resolve([]),
    clientIds.length
      ? prepare<{ id: string; name: string }>(
          `SELECT id, name FROM core.clients WHERE id IN (${clientIds.map(() => "?").join(",")})`,
        ).all(clientIds)
      : Promise.resolve([]),
    projectIds.length
      ? prepare<{ id: string; name: string; color: string }>(
          `SELECT id, name, color FROM core.projects WHERE id IN (${projectIds.map(() => "?").join(",")})`,
        ).all(projectIds)
      : Promise.resolve([]),
  ]);

  const map = new Map<string, { title: string; color: string | null }>();
  for (const t of tasks) map.set(t.id, { title: t.title, color: null });
  for (const c of clients) map.set(c.id, { title: c.name, color: null });
  for (const p of projects) map.set(p.id, { title: p.name, color: p.color });
  return map;
}

export async function listRelations(
  ctx: AuthContext,
  entityType: RelationEntityType,
  entityId: string,
): Promise<RelationWithTarget[]> {
  await requireEntity(ctx, entityType, entityId, "view");

  const raw = await prepare<RawRelation>(
    `SELECT id, org_id, source_type, source_id, target_type, target_id,
            relation_type_id, created_by, created_at
     FROM core.relations
     WHERE org_id = ?
       AND ((source_type = ? AND source_id = ?) OR (target_type = ? AND target_id = ?))
     ORDER BY created_at`,
  ).all(ctx.orgId, entityType, entityId, entityType, entityId);

  const visible = await keepVisible(ctx, raw, entityId);
  const titles = await resolveTitles(visible, entityId);

  return visible.map((r) => {
    const outgoing = r.source_id === entityId && r.source_type === entityType;
    const type = outgoing ? r.target_type : r.source_type;
    const id = outgoing ? r.target_id : r.source_id;
    const resolved = titles.get(id);
    return {
      id: r.id,
      relation_type_id: r.relation_type_id,
      direction: outgoing ? "outgoing" : "incoming",
      entity_type: type,
      entity_id: id,
      title: resolved?.title ?? "Недоступный объект",
      color: resolved?.color ?? null,
      created_at: r.created_at,
    };
  });
}

export async function createRelation(
  ctx: AuthContext,
  input: {
    source_type: RelationEntityType;
    source_id: string;
    target_type: RelationEntityType;
    target_id: string;
    relation_type_id?: string | null;
  },
): Promise<RelationWithTarget[]> {
  if (input.source_type === input.target_type && input.source_id === input.target_id) {
    throw new DomainError(422, "Cannot link an entity to itself");
  }
  // Править — со стороны источника; видеть — обе стороны, иначе связь
  // превращается в способ проверить существование чужого объекта по id.
  await requireEntity(ctx, input.source_type, input.source_id, "edit");
  await requireEntity(ctx, input.target_type, input.target_id, "view");

  if (input.relation_type_id) {
    const row = await prepare(`SELECT 1 FROM core.relation_types WHERE id = ? AND org_id = ?`).get(
      input.relation_type_id,
      ctx.orgId,
    );
    if (!row) throw new DomainError(422, "Unknown relation type");
  }

  await prepare(
    `INSERT INTO core.relations (org_id, source_type, source_id, target_type, target_id, relation_type_id, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (source_type, source_id, target_type, target_id)
       DO UPDATE SET relation_type_id = excluded.relation_type_id`,
  ).run(
    ctx.orgId,
    input.source_type,
    input.source_id,
    input.target_type,
    input.target_id,
    input.relation_type_id ?? null,
    ctx.user.id,
  );

  return listRelations(ctx, input.source_type, input.source_id);
}

export async function deleteRelation(ctx: AuthContext, relationId: string): Promise<void> {
  const row = await prepare<RawRelation>(
    `SELECT id, org_id, source_type, source_id, target_type, target_id,
            relation_type_id, created_by, created_at
     FROM core.relations WHERE id = ? AND org_id = ?`,
  ).get(relationId, ctx.orgId);
  if (!row) throw new DomainError(404, "Relation not found");
  // Достаточно прав на любую из сторон: связь симметрична по смыслу, и
  // требовать доступ к обеим значило бы оставлять неудаляемые «висяки».
  try {
    await requireEntity(ctx, row.source_type, row.source_id, "edit");
  } catch {
    await requireEntity(ctx, row.target_type, row.target_id, "edit");
  }
  await prepare(`DELETE FROM core.relations WHERE id = ? AND org_id = ?`).run(relationId, ctx.orgId);
}
