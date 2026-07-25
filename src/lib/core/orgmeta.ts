// Справочники организации: статусы задач и теги.

import { prepare } from "@/lib/sql";
import { DomainError } from "./http";
import { assertOrg } from "./policy";
import type { AuthContext, CoreTag, StatusKind, TaskStatus } from "./types";

// --- Статусы -----------------------------------------------------------------------

export async function listStatuses(ctx: AuthContext): Promise<TaskStatus[]> {
  return prepare<TaskStatus>(
    `SELECT id, org_id, name, color, kind, position FROM core.task_statuses
     WHERE org_id = ? ORDER BY position, created_at`,
  ).all(ctx.orgId);
}

export async function createStatus(
  ctx: AuthContext,
  input: { name: string; color?: string; kind?: StatusKind },
): Promise<TaskStatus> {
  assertOrg(ctx, "statuses.manage");
  const row = await prepare<TaskStatus>(
    `INSERT INTO core.task_statuses (org_id, name, color, kind, position)
     VALUES (?, ?, ?, ?, COALESCE((SELECT max(position) + 1 FROM core.task_statuses WHERE org_id = ?), 1))
     RETURNING id, org_id, name, color, kind, position`,
  ).get(ctx.orgId, input.name, input.color ?? "#6b7280", input.kind ?? "open", ctx.orgId);
  if (!row) throw new DomainError(500, "Failed to create status");
  return row;
}

export async function updateStatus(
  ctx: AuthContext,
  statusId: string,
  patch: Partial<{ name: string; color: string; kind: StatusKind; position: number }>,
): Promise<TaskStatus> {
  assertOrg(ctx, "statuses.manage");
  const current = await prepare<TaskStatus>(
    `SELECT id, org_id, name, color, kind, position FROM core.task_statuses WHERE id = ? AND org_id = ?`,
  ).get(statusId, ctx.orgId);
  if (!current) throw new DomainError(404, "Status not found");
  const next = { ...current, ...patch };
  const row = await prepare<TaskStatus>(
    `UPDATE core.task_statuses SET name = ?, color = ?, kind = ?, position = ?
     WHERE id = ? RETURNING id, org_id, name, color, kind, position`,
  ).get(next.name, next.color, next.kind, next.position, statusId);
  if (!row) throw new DomainError(500, "Failed to update status");
  return row;
}

export async function deleteStatus(ctx: AuthContext, statusId: string): Promise<void> {
  assertOrg(ctx, "statuses.manage");
  // FK on delete set null: задачи остаются «без статуса».
  const changed = await prepare(`DELETE FROM core.task_statuses WHERE id = ? AND org_id = ?`).run(statusId, ctx.orgId);
  if (changed.changes === 0) throw new DomainError(404, "Status not found");
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
