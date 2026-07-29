// Справочники организации: статусы задач и теги.

import { prepare, transaction } from "@/lib/sql";
import { DomainError } from "./http";
import { assertOrg } from "./policy";
import {
  CATEGORY_LABELS,
  REQUIRED_CATEGORIES,
  deleteBlockMessage,
  fallbackStatusId,
  isWorkingCategory,
  statusDeleteBlock,
} from "./status-model";
import type { AuthContext, CoreTag, StatusCategory, TaskStatus } from "./types";

// --- Статусы -----------------------------------------------------------------------

/**
 * Колонка `kind` в выборке лишняя для типов, но нужна на проводе: пока живут
 * вкладки со старым бандлом, они сравнивают `kind === 'open'`. Уйдёт вместе с
 * дропом колонки следующим выкатом (см. 0041_core_status_categories.sql).
 */
const STATUS_SELECT = `id, org_id, name, color, category, is_default, position, kind`;

export async function listStatuses(ctx: AuthContext): Promise<TaskStatus[]> {
  return prepare<TaskStatus>(
    `SELECT ${STATUS_SELECT} FROM core.task_statuses
     WHERE org_id = ? ORDER BY position, created_at`,
  ).all(ctx.orgId);
}

async function statusesOf(orgId: string): Promise<TaskStatus[]> {
  return prepare<TaskStatus>(
    `SELECT ${STATUS_SELECT} FROM core.task_statuses WHERE org_id = ? ORDER BY position, created_at`,
  ).all(orgId);
}

/**
 * Статус новой задачи. `ORDER BY is_default DESC` вместо `WHERE is_default` —
 * защита от организации, заведённой старым кодом в окно выката: без флага
 * каждое создание задачи в ней отвечало бы 500.
 */
export async function getDefaultStatus(orgId: string): Promise<TaskStatus | null> {
  const row = await prepare<TaskStatus>(
    `SELECT ${STATUS_SELECT} FROM core.task_statuses WHERE org_id = ?
     ORDER BY is_default DESC, position, created_at LIMIT 1`,
  ).get(orgId);
  return row ?? null;
}

export async function createStatus(
  ctx: AuthContext,
  input: { name: string; color?: string; category?: StatusCategory },
): Promise<TaskStatus> {
  assertOrg(ctx, "statuses.manage");
  const row = await prepare<TaskStatus>(
    `INSERT INTO core.task_statuses (org_id, name, color, category, position)
     VALUES (?, ?, ?, ?, COALESCE((SELECT max(position) + 1 FROM core.task_statuses WHERE org_id = ?), 1))
     RETURNING ${STATUS_SELECT}`,
  ).get(ctx.orgId, input.name, input.color ?? "#6b7280", input.category ?? "backlog", ctx.orgId);
  if (!row) throw new DomainError(500, "Failed to create status");
  return row;
}

export async function updateStatus(
  ctx: AuthContext,
  statusId: string,
  patch: Partial<{ name: string; color: string; category: StatusCategory; position: number }> & {
    is_default?: true;
  },
): Promise<TaskStatus> {
  assertOrg(ctx, "statuses.manage");
  const all = await statusesOf(ctx.orgId);
  const current = all.find((s) => s.id === statusId);
  if (!current) throw new DomainError(404, "Status not found");

  const nextCategory = patch.category ?? current.category;
  if (nextCategory !== current.category) {
    if (
      REQUIRED_CATEGORIES.includes(current.category) &&
      !all.some((s) => s.category === current.category && s.id !== statusId)
    ) {
      throw new DomainError(
        422,
        `В категории «${CATEGORY_LABELS[current.category]}» должен остаться хотя бы один статус`,
      );
    }
    // Проверяем до UPDATE: CHECK в базе отдал бы 23514 вместо внятного текста.
    if (current.is_default && !isWorkingCategory(nextCategory)) {
      throw new DomainError(422, "Статус по умолчанию должен оставаться рабочим — сначала назначьте другой");
    }
  }
  if (patch.is_default && !isWorkingCategory(nextCategory)) {
    throw new DomainError(422, "По умолчанию можно назначить только статус из «Бэклога» или «В работе»");
  }

  const next = { ...current, ...patch, category: nextCategory };
  return transaction(async (t) => {
    if (patch.is_default && !current.is_default) {
      // Двумя шагами, а не одним UPDATE по организации: частичный уникальный
      // индекс не откладываемый, и промежуточное состояние с двумя дефолтами
      // упало бы прямо посреди запроса.
      await t.prepare(`UPDATE core.task_statuses SET is_default = false WHERE org_id = ? AND is_default`).run(
        ctx.orgId,
      );
      await t.prepare(`UPDATE core.task_statuses SET is_default = true WHERE id = ? AND org_id = ?`).run(
        statusId,
        ctx.orgId,
      );
    }
    const row = await t
      .prepare<TaskStatus>(
        `UPDATE core.task_statuses SET name = ?, color = ?, category = ?, position = ?
         WHERE id = ? RETURNING ${STATUS_SELECT}`,
      )
      .get(next.name, next.color, next.category, next.position, statusId);
    if (!row) throw new DomainError(500, "Failed to update status");
    return row;
  });
}

export async function deleteStatus(ctx: AuthContext, statusId: string): Promise<void> {
  assertOrg(ctx, "statuses.manage");
  const all = await statusesOf(ctx.orgId);
  const target = all.find((s) => s.id === statusId);
  if (!target) throw new DomainError(404, "Status not found");

  const block = statusDeleteBlock(all, statusId);
  if (block) throw new DomainError(422, deleteBlockMessage(block, target.category));

  const fallbackId = fallbackStatusId(all, statusId);
  if (!fallbackId) throw new DomainError(422, "Удалить последний статус организации нельзя");
  const fallbackDone = all.find((s) => s.id === fallbackId)?.category === "done";

  await transaction(async (t) => {
    // Задачи переезжают явно: FK `on delete set null` оставил бы их без статуса,
    // а пустого статуса у задачи больше не бывает. Событий на задачу не пишем —
    // правка справочника не должна превращаться в лавину в ленте и в push.
    await t
      .prepare(
        `UPDATE core.tasks
            SET status_id = ?,
                completed_at = CASE WHEN ?::boolean THEN COALESCE(completed_at, now()) ELSE NULL END
          WHERE org_id = ? AND status_id = ?`,
      )
      .run(fallbackId, fallbackDone, ctx.orgId, statusId);
    await t.prepare(`DELETE FROM core.task_statuses WHERE id = ? AND org_id = ?`).run(statusId, ctx.orgId);
  });
}

// --- Теги --------------------------------------------------------------------------

export async function listTags(ctx: AuthContext): Promise<CoreTag[]> {
  return prepare<CoreTag>(
    `SELECT id, org_id, name, color, position FROM core.tags WHERE org_id = ? ORDER BY position, name`,
  ).all(ctx.orgId);
}

export async function createTag(ctx: AuthContext, input: { name: string; color?: string }): Promise<CoreTag> {
  assertOrg(ctx, "tags.manage");
  const existing = await prepare<CoreTag>(
    `SELECT id, org_id, name, color, position FROM core.tags WHERE org_id = ? AND name = ?`,
  ).get(ctx.orgId, input.name);
  if (existing) throw new DomainError(409, "Tag with this name already exists");
  const row = await prepare<CoreTag>(
    `INSERT INTO core.tags (org_id, name, color, position)
     VALUES (?, ?, ?, COALESCE((SELECT max(position) + 1 FROM core.tags WHERE org_id = ?), 1))
     RETURNING id, org_id, name, color, position`,
  ).get(ctx.orgId, input.name, input.color ?? "#6b7280", ctx.orgId);
  if (!row) throw new DomainError(500, "Failed to create tag");
  return row;
}

export async function updateTag(
  ctx: AuthContext,
  tagId: string,
  patch: Partial<{ name: string; color: string; position: number }>,
): Promise<CoreTag> {
  assertOrg(ctx, "tags.manage");
  const current = await prepare<CoreTag>(
    `SELECT id, org_id, name, color, position FROM core.tags WHERE id = ? AND org_id = ?`,
  ).get(tagId, ctx.orgId);
  if (!current) throw new DomainError(404, "Tag not found");
  const next = { ...current, ...patch };
  const row = await prepare<CoreTag>(
    `UPDATE core.tags SET name = ?, color = ?, position = ? WHERE id = ?
     RETURNING id, org_id, name, color, position`,
  ).get(next.name, next.color, next.position, tagId);
  if (!row) throw new DomainError(500, "Failed to update tag");
  return row;
}

export async function deleteTag(ctx: AuthContext, tagId: string): Promise<void> {
  assertOrg(ctx, "tags.manage");
  const changed = await prepare(`DELETE FROM core.tags WHERE id = ? AND org_id = ?`).run(tagId, ctx.orgId);
  if (changed.changes === 0) throw new DomainError(404, "Tag not found");
}
