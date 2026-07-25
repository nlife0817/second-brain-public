// Кастомные поля: определения (org- или project-уровень) и типизированные значения.

import { randomUUID } from "node:crypto";
import { prepare } from "@/lib/sql";
import { DomainError } from "./http";
import { assertOrg } from "./policy";
import { requireProject } from "./projects";
import { requireTaskAccess } from "./tasks";
import type { AuthContext, CustomField, FieldOption, FieldType } from "./types";

function normalizeOptions(type: FieldType, options: Array<{ id?: string; label: string; color?: string }> = []): FieldOption[] {
  if (type !== "select" && type !== "multi_select") return [];
  return options.map((o) => ({
    id: o.id ?? randomUUID(),
    label: o.label,
    ...(o.color ? { color: o.color } : {}),
  }));
}

export async function listFields(ctx: AuthContext, projectId?: string): Promise<CustomField[]> {
  if (projectId) {
    await requireProject(ctx, projectId, "project.view");
    return prepare<CustomField>(
      `SELECT id, org_id, project_id, name, type, options, position
       FROM core.custom_fields
       WHERE org_id = ? AND (project_id IS NULL OR project_id = ?)
       ORDER BY position, created_at`,
    ).all(ctx.orgId, projectId);
  }
  return prepare<CustomField>(
    `SELECT id, org_id, project_id, name, type, options, position
     FROM core.custom_fields WHERE org_id = ?
     ORDER BY position, created_at`,
  ).all(ctx.orgId);
}

async function assertFieldManageRights(ctx: AuthContext, projectId: string | null): Promise<void> {
  if (projectId) {
    await requireProject(ctx, projectId, "project.update");
  } else {
    assertOrg(ctx, "fields.manage");
  }
}

export async function createField(
  ctx: AuthContext,
  input: { name: string; type: FieldType; project_id?: string | null; options?: Array<{ label: string; color?: string }> },
): Promise<CustomField> {
  await assertFieldManageRights(ctx, input.project_id ?? null);
  const row = await prepare<CustomField>(
    `INSERT INTO core.custom_fields (org_id, project_id, name, type, options, position)
     VALUES (?, ?, ?, ?, ?::jsonb,
             COALESCE((SELECT max(position) + 1 FROM core.custom_fields WHERE org_id = ?), 1))
     RETURNING id, org_id, project_id, name, type, options, position`,
  ).get(
    ctx.orgId,
    input.project_id ?? null,
    input.name,
    input.type,
    JSON.stringify(normalizeOptions(input.type, input.options)),
    ctx.orgId,
  );
  if (!row) throw new DomainError(500, "Failed to create field");
  return row;
}

export async function updateField(
  ctx: AuthContext,
  fieldId: string,
  patch: { name?: string; options?: Array<{ id?: string; label: string; color?: string }>; position?: number },
): Promise<CustomField> {
  const field = await prepare<CustomField>(
    `SELECT id, org_id, project_id, name, type, options, position FROM core.custom_fields WHERE id = ? AND org_id = ?`,
  ).get(fieldId, ctx.orgId);
  if (!field) throw new DomainError(404, "Field not found");
  await assertFieldManageRights(ctx, field.project_id);

  const row = await prepare<CustomField>(
    `UPDATE core.custom_fields SET name = ?, options = ?::jsonb, position = ?
     WHERE id = ?
     RETURNING id, org_id, project_id, name, type, options, position`,
  ).get(
    patch.name ?? field.name,
    JSON.stringify(patch.options ? normalizeOptions(field.type, patch.options) : field.options),
    patch.position ?? field.position,
    fieldId,
  );
  if (!row) throw new DomainError(500, "Failed to update field");
  return row;
}

export async function deleteField(ctx: AuthContext, fieldId: string): Promise<void> {
  const field = await prepare<CustomField>(
    `SELECT id, org_id, project_id, name, type, options, position FROM core.custom_fields WHERE id = ? AND org_id = ?`,
  ).get(fieldId, ctx.orgId);
  if (!field) throw new DomainError(404, "Field not found");
  await assertFieldManageRights(ctx, field.project_id);
  await prepare(`DELETE FROM core.custom_fields WHERE id = ?`).run(fieldId);
}

// --- Значения ---------------------------------------------------------------------

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function validateValue(ctx: AuthContext, field: CustomField, value: unknown): Promise<unknown> {
  switch (field.type) {
    case "text":
      if (typeof value !== "string" || value.length > 4000) throw new DomainError(422, `${field.name}: expected text`);
      return value;
    case "number":
      if (typeof value !== "number" || !Number.isFinite(value)) throw new DomainError(422, `${field.name}: expected number`);
      return value;
    case "checkbox":
      if (typeof value !== "boolean") throw new DomainError(422, `${field.name}: expected boolean`);
      return value;
    case "date":
      if (typeof value !== "string" || !DATE_RE.test(value)) throw new DomainError(422, `${field.name}: expected YYYY-MM-DD`);
      return value;
    case "url":
      if (typeof value !== "string" || !/^https?:\/\//i.test(value) || value.length > 2000) {
        throw new DomainError(422, `${field.name}: expected http(s) URL`);
      }
      return value;
    case "select": {
      const ids = new Set(field.options.map((o) => o.id));
      if (typeof value !== "string" || !ids.has(value)) throw new DomainError(422, `${field.name}: unknown option`);
      return value;
    }
    case "multi_select": {
      const ids = new Set(field.options.map((o) => o.id));
      if (!Array.isArray(value) || value.some((v) => typeof v !== "string" || !ids.has(v))) {
        throw new DomainError(422, `${field.name}: unknown option`);
      }
      return [...new Set(value)];
    }
    case "user": {
      if (typeof value !== "string" || !UUID_RE.test(value)) throw new DomainError(422, `${field.name}: expected user id`);
      const member = await prepare(`SELECT 1 FROM core.org_members WHERE org_id = ? AND user_id = ?`).get(ctx.orgId, value);
      if (!member) throw new DomainError(422, `${field.name}: user is not an org member`);
      return value;
    }
  }
}

export async function setTaskFieldValue(
  ctx: AuthContext,
  taskId: string,
  fieldId: string,
  value: unknown,
): Promise<void> {
  const access = await requireTaskAccess(ctx, taskId, "edit");
  const field = await prepare<CustomField>(
    `SELECT id, org_id, project_id, name, type, options, position FROM core.custom_fields WHERE id = ? AND org_id = ?`,
  ).get(fieldId, ctx.orgId);
  if (!field) throw new DomainError(404, "Field not found");
  if (field.project_id && !access.placements.some((p) => p.project_id === field.project_id)) {
    throw new DomainError(422, "Field belongs to a project the task is not in");
  }

  if (value === null || value === undefined) {
    await prepare(`DELETE FROM core.task_field_values WHERE task_id = ? AND field_id = ?`).run(taskId, fieldId);
    return;
  }
  const validated = await validateValue(ctx, field, value);
  await prepare(
    `INSERT INTO core.task_field_values (task_id, field_id, value)
     VALUES (?, ?, ?::jsonb)
     ON CONFLICT (task_id, field_id) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
  ).run(taskId, fieldId, JSON.stringify(validated));
}
