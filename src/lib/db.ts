import { prepare, exec, transaction } from "./sql";
import {
  User, UserRole,
  Item, ItemWithSubtasks, Tag, Category, CrmSystem, WeeklyPlan, WeeklyPlanEntry, WeeklyPlanEntryWithItem, WeeklyPlanFull, WeeklyPlanReport, EntryComment,
  Client, ClientFull, ClientStatus, ClientCompany, ClientContact, ClientContactField, ClientNote, ClientLink,
  ContactFieldType,
  RelationType, Relation, RelationWithTarget, Comment, EntityType, RelationEntityType,
  StagingItem, StagingEntityType, StagingStatus,
  IntegrationProvider, IntegrationSettings, IntegrationSettingsInput,
  SyncProfile, SyncProfileInput, SyncFieldMapping, SyncFieldMappingInput,
  ExternalEntityLink, ExternalSyncState, SyncEntityType, SyncDirection, KaitenImportResult,
  DevelopmentParticipant, DevelopmentParticipantInput, KaitenStageOption, SyncOutboxJob, SyncOutboxStatus,
  ItemStatusRow, ItemStatusKind,
} from "@/types";

// Schema and migrations now live in Supabase (supabase/migrations/*.sql).
// ensureDb is kept as a no-op for backwards-compat with any caller that still invokes it.
export async function ensureDb(): Promise<void> {}
export function resetDb(): void {}

export async function seedDefaultCategoriesIfMissing(): Promise<void> {
  const row = await prepare<{ c: number }>("SELECT COUNT(*) as c FROM categories").get();
  if ((row?.c ?? 0) > 0) return;
  const defaults: [string, string, string, string, number][] = [
    ["projects", "Проекты", "#8b5cf6", "FolderKanban", 0],
    ["development", "Разработка", "#3b82f6", "Code2", 1],
    ["clients", "Клиенты", "#22c55e", "Users", 2],
    ["research", "Исследования", "#06b6d4", "FlaskConical", 3],
    ["other", "Другое", "#6b7280", "MoreHorizontal", 4],
    ["prodactstvo", "Продактство", "#f97316", "Target", 5],
    ["launches", "Запуски", "#ef4444", "Rocket", 6],
    ["sales", "Продажи", "#eab308", "TrendingUp", 7],
    ["eva", "EVA", "#ec4899", "Sparkles", 8],
    ["accounting", "Аккаунтинг", "#14b8a6", "BookOpen", 9],
  ];
  await transaction(async (tx) => {
    const stmt = tx.prepare("INSERT INTO categories (id, name, color, icon, position) VALUES (?, ?, ?, ?, ?) ON CONFLICT DO NOTHING");
    for (const [id, name, color, icon, position] of defaults) {
      await stmt.run(id, name, color, icon, position);
    }
  });
}

// Whitelist-based UPDATE clause builder. Untrusted JSON keys never reach SQL —
// only fields explicitly listed in `allowed` are rendered. Returns null when
// the input contains no valid fields.
function buildUpdateClause(
  updates: Record<string, unknown>,
  allowed: readonly string[],
): { sql: string; values: unknown[] } | null {
  const fields: string[] = [];
  const values: unknown[] = [];
  for (const key of allowed) {
    if (Object.prototype.hasOwnProperty.call(updates, key)) {
      fields.push(`${key} = ?`);
      values.push(updates[key]);
    }
  }
  if (fields.length === 0) return null;
  return { sql: fields.join(", "), values };
}

const ITEM_UPDATE_FIELDS = [
  "title", "description", "type", "status", "priority", "category", "source",
  "development_stage", "due_date", "due_time", "estimated_minutes", "position", "parent_id",
] as const;

const TAG_UPDATE_FIELDS = ["name", "color", "position"] as const;
const DEV_STAGE_UPDATE_FIELDS = ["name", "position"] as const;
const ITEM_STATUS_UPDATE_FIELDS = ["name", "color", "position", "kind"] as const;
const DEV_PARTICIPANT_UPDATE_FIELDS = ["name", "position"] as const;
const CATEGORY_UPDATE_FIELDS = ["name", "color", "icon", "position"] as const;
const WEEKLY_PLAN_UPDATE_FIELDS = ["week_start", "week_end", "title", "status"] as const;
const PLAN_ENTRY_UPDATE_FIELDS = ["result_status", "result_comment", "position"] as const;
const CLIENT_STATUS_UPDATE_FIELDS = ["name", "color", "position"] as const;
const CLIENT_UPDATE_FIELDS = [
  "name", "status_id", "position",
  "budget", "operators_per_shift", "operators_total", "calls_per_month", "crm_system",
] as const;
const CRM_SYSTEM_UPDATE_FIELDS = ["name", "position"] as const;
const RELATION_TYPE_UPDATE_FIELDS = ["name", "color", "icon", "position"] as const;
const STAGING_ITEM_UPDATE_FIELDS = [
  "title", "description", "parsed_data", "staging_status", "entity_type", "batch_id",
] as const;

function parseJsonArray(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map((item) => String(item)) : [];
  } catch { return []; }
}

function parseJsonValue<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try { return JSON.parse(value) as T; } catch { return fallback; }
}

function maskToken(token: string): string | null {
  if (!token) return null;
  if (token.length <= 8) return "********";
  return `${token.slice(0, 4)}...${token.slice(-4)}`;
}

function buildApiBaseUrl(companyDomain: string): string {
  if (!companyDomain.trim()) return "";
  const sanitized = companyDomain.trim().replace(/^https?:\/\//, "").replace(/\.kaiten\.ru\/?$/, "").replace(/\/+$/, "");
  return sanitized ? `https://${sanitized}.kaiten.ru/api/latest` : "";
}

function mapIntegrationSettings(row?: {
  provider: string; enabled: number; company_domain: string; api_base_url: string;
  token_secret: string; default_import_target: "staging"; created_at: string; updated_at: string;
}): IntegrationSettings {
  const provider = (row?.provider ?? "kaiten") as IntegrationProvider;
  const token = row?.token_secret ?? "";
  return {
    provider,
    enabled: !!row?.enabled,
    company_domain: row?.company_domain ?? "",
    api_base_url: row?.api_base_url ?? buildApiBaseUrl(row?.company_domain ?? ""),
    has_token: token.length > 0,
    token_masked: maskToken(token),
    default_import_target: "staging",
    created_at: row?.created_at ?? new Date(0).toISOString(),
    updated_at: row?.updated_at ?? new Date(0).toISOString(),
  };
}

// ---------------- Items ----------------

export async function getAllItems(includeArchived = false, includeChildren = false): Promise<Item[]> {
  const conditions: string[] = [];
  if (!includeArchived) conditions.push("i.status != 'archived'");
  if (!includeChildren) conditions.push("i.parent_id IS NULL");
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  return await prepare<Item>(`SELECT * FROM items i ${where} ORDER BY position ASC, created_at DESC`).all();
}

export async function getItemById(id: string): Promise<Item | undefined> {
  return await prepare<Item>("SELECT * FROM items WHERE id = ?").get(id);
}

export async function getSubtasks(parentId: string): Promise<Item[]> {
  return await prepare<Item>("SELECT * FROM items WHERE parent_id = ? ORDER BY position ASC").all(parentId);
}

export async function getItemTags(itemId: string): Promise<Tag[]> {
  return await prepare<Tag>(`
    SELECT t.* FROM tags t
    JOIN item_tags it ON t.id = it.tag_id
    WHERE it.item_id = ?
  `).all(itemId);
}

export async function getItemParticipants(itemId: string): Promise<DevelopmentParticipant[]> {
  return await prepare<DevelopmentParticipant>(`
    SELECT p.* FROM development_participants p
    JOIN item_development_participants ip ON p.id = ip.participant_id
    WHERE ip.item_id = ?
    ORDER BY LOWER(p.name) ASC
  `).all(itemId);
}

export async function getAllItemsFull(includeArchived = false, includeChildren = false): Promise<ItemWithSubtasks[]> {
  const conditions: string[] = [];
  if (!includeArchived) conditions.push("i.status != 'archived'");
  if (!includeChildren) conditions.push("i.parent_id IS NULL");
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const items = await prepare<Item>(`SELECT * FROM items i ${where} ORDER BY position ASC, created_at DESC`).all();
  if (items.length === 0) return [];

  const allSubtasks = await prepare<Item>(`SELECT * FROM items WHERE parent_id IS NOT NULL ORDER BY position ASC`).all();
  const subtaskMap = new Map<string, Item[]>();
  for (const sub of allSubtasks) {
    if (!sub.parent_id) continue;
    const list = subtaskMap.get(sub.parent_id);
    if (list) list.push(sub); else subtaskMap.set(sub.parent_id, [sub]);
  }

  const allItemTags = await prepare<Tag & { item_id: string }>(`
    SELECT it.item_id, t.* FROM tags t
    JOIN item_tags it ON t.id = it.tag_id
  `).all();
  const tagMap = new Map<string, Tag[]>();
  for (const row of allItemTags) {
    const tag: Tag = { id: row.id, name: row.name, color: row.color, position: row.position };
    const list = tagMap.get(row.item_id);
    if (list) list.push(tag); else tagMap.set(row.item_id, [tag]);
  }

  const allItemParticipants = await prepare<DevelopmentParticipant & { item_id: string }>(`
    SELECT ip.item_id, p.* FROM development_participants p
    JOIN item_development_participants ip ON p.id = ip.participant_id
    ORDER BY LOWER(p.name) ASC
  `).all();
  const participantMap = new Map<string, DevelopmentParticipant[]>();
  for (const row of allItemParticipants) {
    const p: DevelopmentParticipant = {
      id: row.id, provider: row.provider, remote_id: row.remote_id, name: row.name,
      position: row.position, created_at: row.created_at, updated_at: row.updated_at,
    };
    const list = participantMap.get(row.item_id);
    if (list) list.push(p); else participantMap.set(row.item_id, [p]);
  }

  return items.map((item) => ({
    ...item,
    subtasks: subtaskMap.get(item.id) ?? [],
    tags: tagMap.get(item.id) ?? [],
    participants: participantMap.get(item.id) ?? [],
  }));
}

export async function getItemFull(id: string): Promise<ItemWithSubtasks | undefined> {
  const item = await getItemById(id);
  if (!item) return undefined;
  const [subtasks, tags, participants] = await Promise.all([
    getSubtasks(item.id),
    getItemTags(item.id),
    getItemParticipants(item.id),
  ]);
  return { ...item, subtasks, tags, participants };
}

export async function setItemParticipants(itemId: string, participants: DevelopmentParticipantInput[]): Promise<DevelopmentParticipant[]> {
  const now = new Date().toISOString();
  const normalized = participants
    .map((p) => ({
      provider: p.provider ?? null,
      remote_id: p.remote_id ?? null,
      name: p.name.trim(),
    }))
    .filter((p) => p.name.length > 0);

  await transaction(async (tx) => {
    await tx.prepare("DELETE FROM item_development_participants WHERE item_id = ?").run(itemId);
    for (const participant of normalized) {
      let existing: DevelopmentParticipant | undefined;
      if (participant.remote_id) {
        existing = await tx.prepare<DevelopmentParticipant>(
          "SELECT * FROM development_participants WHERE provider IS NOT DISTINCT FROM ? AND remote_id IS NOT DISTINCT FROM ?"
        ).get(participant.provider, participant.remote_id);
      } else {
        existing = await tx.prepare<DevelopmentParticipant>(
          "SELECT * FROM development_participants WHERE provider IS NULL AND remote_id IS NULL AND name = ?"
        ).get(participant.name);
      }

      let participantId: string;
      if (existing) {
        participantId = existing.id;
        if (existing.name !== participant.name) {
          await tx.prepare("UPDATE development_participants SET name = ?, updated_at = ? WHERE id = ?").run(participant.name, now, participantId);
        }
      } else {
        participantId = crypto.randomUUID();
        await tx.prepare(`
          INSERT INTO development_participants (id, provider, remote_id, name, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(participantId, participant.provider, participant.remote_id, participant.name, now, now);
      }

      await tx.prepare("INSERT INTO item_development_participants (item_id, participant_id) VALUES (?, ?) ON CONFLICT DO NOTHING").run(itemId, participantId);
    }
  });

  return await getItemParticipants(itemId);
}

export async function createItem(item: Omit<Item, "created_at" | "updated_at">): Promise<Item> {
  const now = new Date().toISOString();
  const maxPos = await prepare<{ next_pos: number }>(
    "SELECT COALESCE(MAX(position), -1) + 1 as next_pos FROM items WHERE status = ? AND parent_id IS NOT DISTINCT FROM ?"
  ).get(item.status, item.parent_id ?? null);

  await prepare(`
    INSERT INTO items (id, title, description, type, status, priority, category, source, development_stage, due_date, due_time, estimated_minutes, position, parent_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    item.id, item.title, item.description, item.type, item.status,
    item.priority, item.category, item.source ?? "system", item.development_stage ?? null,
    item.due_date ?? null, item.due_time ?? null, item.estimated_minutes ?? null,
    item.position ?? maxPos?.next_pos ?? 0, item.parent_id ?? null, now, now
  );
  return (await getItemById(item.id))!;
}

export async function updateItem(id: string, updates: Partial<Item>): Promise<Item | undefined> {
  const existing = await getItemById(id);
  if (!existing) return undefined;

  const built = buildUpdateClause(updates as Record<string, unknown>, ITEM_UPDATE_FIELDS);
  if (!built) return existing;

  const now = new Date().toISOString();
  await prepare(`UPDATE items SET ${built.sql}, updated_at = ? WHERE id = ?`)
    .run(...built.values, now, id);
  return await getItemById(id);
}

export async function deleteItem(id: string): Promise<boolean> {
  const result = await prepare("DELETE FROM items WHERE id = ?").run(id);
  return result.changes > 0;
}

// ---------------- Tags ----------------

export async function getAllTags(): Promise<Tag[]> {
  return await prepare<Tag>("SELECT * FROM tags ORDER BY position ASC, name ASC").all();
}

export async function createTag(tag: Pick<Tag, "id" | "name" | "color">): Promise<Tag> {
  const maxPos = await prepare<{ p: number }>("SELECT COALESCE(MAX(position), -1) + 1 as p FROM tags").get();
  await prepare("INSERT INTO tags (id, name, color, position) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING").run(tag.id, tag.name, tag.color, maxPos?.p ?? 0);
  return (await prepare<Tag>("SELECT * FROM tags WHERE id = ?").get(tag.id))!;
}

export async function updateTag(id: string, updates: Partial<Pick<Tag, "name" | "color" | "position">>): Promise<Tag | undefined> {
  const built = buildUpdateClause(updates as Record<string, unknown>, TAG_UPDATE_FIELDS);
  if (!built) return await prepare<Tag>("SELECT * FROM tags WHERE id = ?").get(id);
  await prepare(`UPDATE tags SET ${built.sql} WHERE id = ?`).run(...built.values, id);
  return await prepare<Tag>("SELECT * FROM tags WHERE id = ?").get(id);
}

export async function deleteTag(id: string): Promise<boolean> {
  await prepare("DELETE FROM item_tags WHERE tag_id = ?").run(id);
  const result = await prepare("DELETE FROM tags WHERE id = ?").run(id);
  return result.changes > 0;
}

export async function setItemTags(itemId: string, tagIds: string[]): Promise<void> {
  await transaction(async (tx) => {
    await tx.prepare("DELETE FROM item_tags WHERE item_id = ?").run(itemId);
    for (const tagId of tagIds) {
      await tx.prepare("INSERT INTO item_tags (item_id, tag_id) VALUES (?, ?)").run(itemId, tagId);
    }
  });
}

// ---------------- Development Stages ----------------

export interface DevelopmentStage { id: string; name: string; position: number; }

export async function getAllDevelopmentStages(): Promise<DevelopmentStage[]> {
  return await prepare<DevelopmentStage>("SELECT * FROM development_stages ORDER BY position ASC").all();
}

export async function createDevelopmentStage(data: { id: string; name: string }): Promise<DevelopmentStage> {
  const maxPos = await prepare<{ p: number }>("SELECT COALESCE(MAX(position), -1) + 1 as p FROM development_stages").get();
  await prepare("INSERT INTO development_stages (id, name, position) VALUES (?, ?, ?)").run(data.id, data.name, maxPos?.p ?? 0);
  return (await prepare<DevelopmentStage>("SELECT * FROM development_stages WHERE id = ?").get(data.id))!;
}

export async function updateDevelopmentStage(id: string, updates: Partial<Pick<DevelopmentStage, "name" | "position">>): Promise<DevelopmentStage | undefined> {
  const built = buildUpdateClause(updates as Record<string, unknown>, DEV_STAGE_UPDATE_FIELDS);
  if (!built) return await prepare<DevelopmentStage>("SELECT * FROM development_stages WHERE id = ?").get(id);
  await prepare(`UPDATE development_stages SET ${built.sql} WHERE id = ?`).run(...built.values, id);
  return await prepare<DevelopmentStage>("SELECT * FROM development_stages WHERE id = ?").get(id);
}

export async function deleteDevelopmentStage(id: string): Promise<boolean> {
  const result = await prepare("DELETE FROM development_stages WHERE id = ?").run(id);
  return result.changes > 0;
}

// ---------------- Item statuses (user-editable) ----------------

export async function getAllItemStatuses(): Promise<ItemStatusRow[]> {
  return await prepare<ItemStatusRow>(
    "SELECT * FROM item_statuses ORDER BY position ASC, LOWER(name) ASC"
  ).all();
}

export async function createItemStatus(data: {
  id: string;
  name: string;
  color?: string;
  kind?: ItemStatusKind;
}): Promise<ItemStatusRow> {
  const maxPos = await prepare<{ p: number }>(
    "SELECT COALESCE(MAX(position), -1) + 1 as p FROM item_statuses"
  ).get();
  const now = new Date().toISOString();
  await prepare(
    "INSERT INTO item_statuses (id, name, color, position, kind, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).run(
    data.id,
    data.name,
    data.color ?? "#94a3b8",
    maxPos?.p ?? 0,
    data.kind ?? "open",
    now,
    now
  );
  return (await prepare<ItemStatusRow>(
    "SELECT * FROM item_statuses WHERE id = ?"
  ).get(data.id))!;
}

export async function updateItemStatus(
  id: string,
  updates: Partial<Pick<ItemStatusRow, "name" | "color" | "position" | "kind">>
): Promise<ItemStatusRow | undefined> {
  const built = buildUpdateClause(
    updates as Record<string, unknown>,
    ITEM_STATUS_UPDATE_FIELDS
  );
  if (!built)
    return await prepare<ItemStatusRow>(
      "SELECT * FROM item_statuses WHERE id = ?"
    ).get(id);
  const now = new Date().toISOString();
  await prepare(
    `UPDATE item_statuses SET ${built.sql}, updated_at = ? WHERE id = ?`
  ).run(...built.values, now, id);
  return await prepare<ItemStatusRow>(
    "SELECT * FROM item_statuses WHERE id = ?"
  ).get(id);
}

// Returns false if the status doesn't exist or is referenced by any item.
// Reassigning items to another status is the caller's responsibility.
export async function deleteItemStatus(id: string): Promise<{
  ok: boolean;
  reason?: "in_use" | "not_found";
  inUseCount?: number;
}> {
  const existing = await prepare<{ id: string }>(
    "SELECT id FROM item_statuses WHERE id = ?"
  ).get(id);
  if (!existing) return { ok: false, reason: "not_found" };
  const count = await prepare<{ c: number }>(
    "SELECT COUNT(*) as c FROM items WHERE status = ?"
  ).get(id);
  if ((count?.c ?? 0) > 0) {
    return { ok: false, reason: "in_use", inUseCount: count!.c };
  }
  await prepare("DELETE FROM item_statuses WHERE id = ?").run(id);
  return { ok: true };
}

// ---------------- Development Participants ----------------

export async function getAllDevelopmentParticipants(): Promise<DevelopmentParticipant[]> {
  return await prepare<DevelopmentParticipant>("SELECT * FROM development_participants ORDER BY position ASC, LOWER(name) ASC").all();
}

export async function updateDevelopmentParticipant(id: string, updates: Partial<Pick<DevelopmentParticipant, "name" | "position">>): Promise<DevelopmentParticipant | undefined> {
  const built = buildUpdateClause(updates as Record<string, unknown>, DEV_PARTICIPANT_UPDATE_FIELDS);
  if (!built) return await prepare<DevelopmentParticipant>("SELECT * FROM development_participants WHERE id = ?").get(id);
  const now = new Date().toISOString();
  await prepare(`UPDATE development_participants SET ${built.sql}, updated_at = ? WHERE id = ?`)
    .run(...built.values, now, id);
  return await prepare<DevelopmentParticipant>("SELECT * FROM development_participants WHERE id = ?").get(id);
}

export async function deleteDevelopmentParticipant(id: string): Promise<boolean> {
  await prepare("DELETE FROM item_development_participants WHERE participant_id = ?").run(id);
  const result = await prepare("DELETE FROM development_participants WHERE id = ?").run(id);
  return result.changes > 0;
}

export async function createDevelopmentParticipant(name: string): Promise<DevelopmentParticipant> {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const maxPos = await prepare<{ p: number }>("SELECT COALESCE(MAX(position), -1) + 1 as p FROM development_participants").get();
  await prepare("INSERT INTO development_participants (id, provider, remote_id, name, position, created_at, updated_at) VALUES (?, NULL, NULL, ?, ?, ?, ?)")
    .run(id, name, maxPos?.p ?? 0, now, now);
  return (await prepare<DevelopmentParticipant>("SELECT * FROM development_participants WHERE id = ?").get(id))!;
}

// ---------------- Categories ----------------

export async function getAllCategories(): Promise<Category[]> {
  return await prepare<Category>("SELECT * FROM categories ORDER BY position ASC").all();
}

export async function getCategoryById(id: string): Promise<Category | undefined> {
  return await prepare<Category>("SELECT * FROM categories WHERE id = ?").get(id);
}

export async function createCategory(cat: Omit<Category, "position">): Promise<Category> {
  const maxPos = await prepare<{ next_pos: number }>("SELECT COALESCE(MAX(position), -1) + 1 as next_pos FROM categories").get();
  await prepare("INSERT INTO categories (id, name, color, icon, position) VALUES (?, ?, ?, ?, ?)")
    .run(cat.id, cat.name, cat.color, cat.icon, maxPos?.next_pos ?? 0);
  return (await getCategoryById(cat.id))!;
}

export async function updateCategory(id: string, updates: Partial<Pick<Category, "name" | "color" | "icon" | "position">>): Promise<Category | undefined> {
  const existing = await getCategoryById(id);
  if (!existing) return undefined;
  const built = buildUpdateClause(updates as Record<string, unknown>, CATEGORY_UPDATE_FIELDS);
  if (!built) return existing;
  await prepare(`UPDATE categories SET ${built.sql} WHERE id = ?`).run(...built.values, id);
  return await getCategoryById(id);
}

export async function deleteCategory(id: string): Promise<boolean> {
  await prepare("UPDATE items SET category = 'other' WHERE category = ?").run(id);
  const result = await prepare("DELETE FROM categories WHERE id = ?").run(id);
  return result.changes > 0;
}

export async function reorderItems(items: { id: string; position: number; status?: string }[]): Promise<void> {
  const now = new Date().toISOString();
  await transaction(async (tx) => {
    for (const item of items) {
      if (item.status !== undefined) {
        await tx.prepare("UPDATE items SET position = ?, status = ?, updated_at = ? WHERE id = ?")
          .run(item.position, item.status, now, item.id);
      } else {
        await tx.prepare("UPDATE items SET position = ?, updated_at = ? WHERE id = ?")
          .run(item.position, now, item.id);
      }
    }
  });
}

// ---------------- Weekly Plans ----------------

export async function getAllWeeklyPlans(): Promise<WeeklyPlan[]> {
  return await prepare<WeeklyPlan>("SELECT * FROM weekly_plans ORDER BY week_start DESC").all();
}

export async function getWeeklyPlanById(id: string): Promise<WeeklyPlan | undefined> {
  return await prepare<WeeklyPlan>("SELECT * FROM weekly_plans WHERE id = ?").get(id);
}

export async function getWeeklyPlanFull(id: string): Promise<WeeklyPlanFull | undefined> {
  const plan = await getWeeklyPlanById(id);
  if (!plan) return undefined;

  const rows = await prepare<WeeklyPlanEntry & Record<string, unknown>>(`
    SELECT e.*, i.title as item_title, i.description as item_description,
           i.type as item_type, i.status as item_status, i.priority as item_priority,
           i.category as item_category, i.source as item_source, i.development_stage as item_development_stage,
           i.due_date as item_due_date, i.due_time as item_due_time,
           i.estimated_minutes as item_estimated_minutes,
           i.position as item_position, i.parent_id as item_parent_id,
           i.created_at as item_created_at, i.updated_at as item_updated_at
    FROM weekly_plan_entries e
    JOIN items i ON e.item_id = i.id
    WHERE e.plan_id = ?
    ORDER BY e.position ASC
  `).all(id);

  const entryIds = rows.map((r) => r.id as string);
  let allComments: EntryComment[] = [];
  if (entryIds.length > 0) {
    const placeholders = entryIds.map(() => "?").join(",");
    allComments = await prepare<EntryComment>(
      `SELECT * FROM entry_comments WHERE entry_id IN (${placeholders}) ORDER BY created_at ASC`
    ).all(...entryIds);
  }
  const commentsByEntry = new Map<string, EntryComment[]>();
  for (const c of allComments) {
    const list = commentsByEntry.get(c.entry_id);
    if (list) list.push(c); else commentsByEntry.set(c.entry_id, [c]);
  }

  const entries: WeeklyPlanEntryWithItem[] = rows.map((row) => {
    const entryId = row.id as string;
    return {
      id: entryId,
      plan_id: row.plan_id as string,
      item_id: row.item_id as string,
      position: row.position as number,
      result_status: row.result_status as WeeklyPlanEntry["result_status"],
      result_comment: row.result_comment as string,
      created_at: row.created_at as string,
      updated_at: row.updated_at as string,
      comments: commentsByEntry.get(entryId) ?? [],
      item: {
        id: row.item_id as string,
        title: row.item_title as string,
        description: row.item_description as string,
        type: row.item_type as Item["type"],
        status: row.item_status as Item["status"],
        priority: row.item_priority as Item["priority"],
        category: row.item_category as Item["category"],
        source: (row.item_source as Item["source"]) || "system",
        development_stage: (row.item_development_stage as string) || null,
        due_date: (row.item_due_date as string) || null,
        due_time: (row.item_due_time as string) || null,
        estimated_minutes: (row.item_estimated_minutes as number | null) ?? null,
        position: row.item_position as number,
        parent_id: (row.item_parent_id as string) || null,
        created_at: row.item_created_at as string,
        updated_at: row.item_updated_at as string,
      },
    };
  });

  return { ...plan, entries };
}

export async function createWeeklyPlan(plan: Pick<WeeklyPlan, "id" | "week_start" | "week_end" | "title">): Promise<WeeklyPlan> {
  const now = new Date().toISOString();
  await prepare(`
    INSERT INTO weekly_plans (id, week_start, week_end, title, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'active', ?, ?)
  `).run(plan.id, plan.week_start, plan.week_end, plan.title, now, now);
  return (await getWeeklyPlanById(plan.id))!;
}

export async function updateWeeklyPlan(id: string, updates: Partial<WeeklyPlan>): Promise<WeeklyPlan | undefined> {
  const existing = await getWeeklyPlanById(id);
  if (!existing) return undefined;
  const built = buildUpdateClause(updates as Record<string, unknown>, WEEKLY_PLAN_UPDATE_FIELDS);
  if (!built) return existing;
  const now = new Date().toISOString();
  await prepare(`UPDATE weekly_plans SET ${built.sql}, updated_at = ? WHERE id = ?`)
    .run(...built.values, now, id);
  return await getWeeklyPlanById(id);
}

export async function deleteWeeklyPlan(id: string): Promise<boolean> {
  const result = await prepare("DELETE FROM weekly_plans WHERE id = ?").run(id);
  return result.changes > 0;
}

export async function addItemToPlan(planId: string, itemId: string): Promise<WeeklyPlanEntry | null> {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const maxPos = await prepare<{ next_pos: number }>(
    "SELECT COALESCE(MAX(position), -1) + 1 as next_pos FROM weekly_plan_entries WHERE plan_id = ?"
  ).get(planId);
  try {
    await prepare(`
      INSERT INTO weekly_plan_entries (id, plan_id, item_id, position, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, planId, itemId, maxPos?.next_pos ?? 0, now, now);
    return (await prepare<WeeklyPlanEntry>("SELECT * FROM weekly_plan_entries WHERE id = ?").get(id)) ?? null;
  } catch {
    return null;
  }
}

export async function bulkAddItemsToPlan(planId: string, itemIds: string[]): Promise<number> {
  const now = new Date().toISOString();
  let added = 0;
  const maxPos = await prepare<{ next_pos: number }>(
    "SELECT COALESCE(MAX(position), -1) + 1 as next_pos FROM weekly_plan_entries WHERE plan_id = ?"
  ).get(planId);
  const base = maxPos?.next_pos ?? 0;
  await transaction(async (tx) => {
    for (let i = 0; i < itemIds.length; i++) {
      const result = await tx.prepare(`
        INSERT INTO weekly_plan_entries (id, plan_id, item_id, position, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT (plan_id, item_id) DO NOTHING
      `).run(crypto.randomUUID(), planId, itemIds[i], base + i, now, now);
      added += result.changes;
    }
  });
  return added;
}

export async function removeItemFromPlan(planId: string, itemId: string): Promise<boolean> {
  const result = await prepare("DELETE FROM weekly_plan_entries WHERE plan_id = ? AND item_id = ?").run(planId, itemId);
  return result.changes > 0;
}

export async function updatePlanEntry(entryId: string, updates: Partial<Pick<WeeklyPlanEntry, "result_status" | "result_comment" | "position">>): Promise<WeeklyPlanEntry | undefined> {
  const built = buildUpdateClause(updates as Record<string, unknown>, PLAN_ENTRY_UPDATE_FIELDS);
  if (!built) return undefined;
  const now = new Date().toISOString();
  await prepare(`UPDATE weekly_plan_entries SET ${built.sql}, updated_at = ? WHERE id = ?`)
    .run(...built.values, now, entryId);
  return await prepare<WeeklyPlanEntry>("SELECT * FROM weekly_plan_entries WHERE id = ?").get(entryId);
}

export async function getTransferableEntries(planId: string): Promise<WeeklyPlanEntryWithItem[]> {
  const rows = await prepare<WeeklyPlanEntry & Record<string, unknown>>(`
    SELECT e.*, i.title as item_title, i.description as item_description,
           i.type as item_type, i.status as item_status, i.priority as item_priority,
           i.category as item_category, i.source as item_source, i.development_stage as item_development_stage,
           i.due_date as item_due_date, i.due_time as item_due_time,
           i.estimated_minutes as item_estimated_minutes,
           i.position as item_position, i.parent_id as item_parent_id,
           i.created_at as item_created_at, i.updated_at as item_updated_at
    FROM weekly_plan_entries e
    JOIN items i ON e.item_id = i.id
    WHERE e.plan_id = ? AND e.result_status = 'transferred'
    ORDER BY e.position ASC
  `).all(planId);

  const result: WeeklyPlanEntryWithItem[] = [];
  for (const row of rows) {
    const entryId = row.id as string;
    const comments = await prepare<EntryComment>(
      "SELECT * FROM entry_comments WHERE entry_id = ? ORDER BY created_at ASC"
    ).all(entryId);
    result.push({
      id: entryId,
      plan_id: row.plan_id as string,
      item_id: row.item_id as string,
      position: row.position as number,
      result_status: row.result_status as WeeklyPlanEntry["result_status"],
      result_comment: row.result_comment as string,
      created_at: row.created_at as string,
      updated_at: row.updated_at as string,
      comments,
      item: {
        id: row.item_id as string,
        title: row.item_title as string,
        description: row.item_description as string,
        type: row.item_type as Item["type"],
        status: row.item_status as Item["status"],
        priority: row.item_priority as Item["priority"],
        category: row.item_category as Item["category"],
        source: (row.item_source as Item["source"]) || "system",
        development_stage: (row.item_development_stage as string) || null,
        due_date: (row.item_due_date as string) || null,
        due_time: (row.item_due_time as string) || null,
        estimated_minutes: (row.item_estimated_minutes as number | null) ?? null,
        position: row.item_position as number,
        parent_id: (row.item_parent_id as string) || null,
        created_at: row.item_created_at as string,
        updated_at: row.item_updated_at as string,
      },
    });
  }
  return result;
}

export async function getUnplannedDoneItems(weekStart: string, weekEnd: string, planId: string): Promise<Item[]> {
  return await prepare<Item>(`
    SELECT i.* FROM items i
    WHERE i.status = 'done'
      AND i.updated_at >= ? AND i.updated_at < (?::date + INTERVAL '1 day')::text
      AND i.id NOT IN (SELECT item_id FROM weekly_plan_entries WHERE plan_id = ?)
      AND i.parent_id IS NULL
    ORDER BY i.updated_at DESC
  `).all(weekStart, weekEnd, planId);
}

export async function completeWeeklyPlan(planId: string): Promise<WeeklyPlanFull | undefined> {
  const plan = await getWeeklyPlanFull(planId);
  if (!plan) return undefined;
  const now = new Date().toISOString();
  await transaction(async (tx) => {
    for (const entry of plan.entries) {
      if (entry.result_status !== "pending") continue;
      const newStatus = entry.item.status === "done" ? "done" : "not_done";
      await tx.prepare("UPDATE weekly_plan_entries SET result_status = ?, updated_at = ? WHERE id = ?")
        .run(newStatus, now, entry.id);
    }
    await tx.prepare("UPDATE weekly_plans SET status = 'completed', updated_at = ? WHERE id = ?")
      .run(now, planId);
  });
  return await getWeeklyPlanFull(planId);
}

// ---------------- Entry Comments ----------------

export async function getEntryComments(entryId: string): Promise<EntryComment[]> {
  return await prepare<EntryComment>("SELECT * FROM entry_comments WHERE entry_id = ? ORDER BY created_at ASC").all(entryId);
}

export async function addEntryComment(entryId: string, text: string): Promise<EntryComment> {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await prepare("INSERT INTO entry_comments (id, entry_id, text, created_at) VALUES (?, ?, ?, ?)").run(id, entryId, text, now);
  await prepare("UPDATE weekly_plan_entries SET result_comment = ?, updated_at = ? WHERE id = ?").run(text, now, entryId);
  return { id, entry_id: entryId, text, created_at: now };
}

export async function deleteEntryComment(commentId: string): Promise<boolean> {
  const result = await prepare("DELETE FROM entry_comments WHERE id = ?").run(commentId);
  return result.changes > 0;
}

export async function getWeeklyPlanReport(planId: string): Promise<WeeklyPlanReport | undefined> {
  const plan = await getWeeklyPlanFull(planId);
  if (!plan) return undefined;
  const done = plan.entries.filter((e) => e.result_status === "done");
  const not_done = plan.entries.filter((e) => e.result_status === "not_done");
  const transferred = plan.entries.filter((e) => e.result_status === "transferred");
  const unplanned_done = await getUnplannedDoneItems(plan.week_start, plan.week_end, planId);
  const total = plan.entries.length;
  return {
    plan, done, not_done, transferred, unplanned_done, total,
    done_count: done.length,
    completion_rate: total > 0 ? Math.round((done.length / total) * 100) : 0,
  };
}

// ---------------- Client Statuses ----------------

export async function getAllClientStatuses(): Promise<ClientStatus[]> {
  return await prepare<ClientStatus>("SELECT * FROM client_statuses ORDER BY position ASC").all();
}

export async function createClientStatus(status: Pick<ClientStatus, "id" | "name" | "color">): Promise<ClientStatus> {
  const maxPos = await prepare<{ p: number }>("SELECT COALESCE(MAX(position), -1) + 1 as p FROM client_statuses").get();
  await prepare("INSERT INTO client_statuses (id, name, color, position) VALUES (?, ?, ?, ?)").run(status.id, status.name, status.color, maxPos?.p ?? 0);
  return (await prepare<ClientStatus>("SELECT * FROM client_statuses WHERE id = ?").get(status.id))!;
}

export async function updateClientStatus(id: string, updates: Partial<Pick<ClientStatus, "name" | "color" | "position">>): Promise<ClientStatus | undefined> {
  const built = buildUpdateClause(updates as Record<string, unknown>, CLIENT_STATUS_UPDATE_FIELDS);
  if (!built) return await prepare<ClientStatus>("SELECT * FROM client_statuses WHERE id = ?").get(id);
  await prepare(`UPDATE client_statuses SET ${built.sql} WHERE id = ?`).run(...built.values, id);
  return await prepare<ClientStatus>("SELECT * FROM client_statuses WHERE id = ?").get(id);
}

export async function deleteClientStatus(id: string): Promise<boolean> {
  const result = await prepare("DELETE FROM client_statuses WHERE id = ?").run(id);
  return result.changes > 0;
}

// ---------------- Clients ----------------

export async function getAllClients(): Promise<Client[]> {
  return await prepare<Client>("SELECT * FROM clients ORDER BY position ASC, created_at DESC").all();
}

export async function getClientById(id: string): Promise<Client | undefined> {
  return await prepare<Client>("SELECT * FROM clients WHERE id = ?").get(id);
}

export async function getClientFull(id: string): Promise<ClientFull | undefined> {
  const client = await getClientById(id);
  if (!client) return undefined;

  const status = client.status_id
    ? ((await prepare<ClientStatus>("SELECT * FROM client_statuses WHERE id = ?").get(client.status_id)) ?? null)
    : null;

  const companies = await prepare<ClientCompany>("SELECT * FROM client_companies WHERE client_id = ?").all(id);
  const contactRows = await prepare<ClientContact>("SELECT * FROM client_contacts WHERE client_id = ? ORDER BY position ASC").all(id);
  const contacts: ClientContact[] = [];
  for (const c of contactRows) {
    const fields = await prepare<ClientContactField>("SELECT * FROM client_contact_fields WHERE contact_id = ?").all(c.id);
    contacts.push({ ...c, fields });
  }
  const notes = await prepare<ClientNote>("SELECT * FROM client_notes WHERE client_id = ? ORDER BY created_at DESC").all(id);
  const links = await prepare<ClientLink>("SELECT * FROM client_links WHERE client_id = ?").all(id);
  const crm_systems = await getClientCrmSystems(id);

  return { ...client, status, companies, contacts, notes, links, crm_systems };
}

export async function getAllClientsFull(): Promise<ClientFull[]> {
  const clients = await getAllClients();
  if (clients.length === 0) return [];

  const statusMap = new Map<string, ClientStatus>();
  for (const s of await getAllClientStatuses()) statusMap.set(s.id, s);

  const allCompanies = await prepare<ClientCompany>("SELECT * FROM client_companies").all();
  const companyMap = new Map<string, ClientCompany[]>();
  for (const c of allCompanies) {
    const list = companyMap.get(c.client_id);
    if (list) list.push(c); else companyMap.set(c.client_id, [c]);
  }

  const allContacts = await prepare<ClientContact>("SELECT * FROM client_contacts ORDER BY position ASC").all();
  const allFields = await prepare<ClientContactField>("SELECT * FROM client_contact_fields").all();
  const fieldMap = new Map<string, ClientContactField[]>();
  for (const f of allFields) {
    const list = fieldMap.get(f.contact_id);
    if (list) list.push(f); else fieldMap.set(f.contact_id, [f]);
  }
  const contactMap = new Map<string, ClientContact[]>();
  for (const c of allContacts) {
    const contact = { ...c, fields: fieldMap.get(c.id) ?? [] };
    const list = contactMap.get(c.client_id);
    if (list) list.push(contact); else contactMap.set(c.client_id, [contact]);
  }

  const allNotes = await prepare<ClientNote>("SELECT * FROM client_notes ORDER BY created_at DESC").all();
  const noteMap = new Map<string, ClientNote[]>();
  for (const n of allNotes) {
    const list = noteMap.get(n.client_id);
    if (list) list.push(n); else noteMap.set(n.client_id, [n]);
  }

  const allLinks = await prepare<ClientLink>("SELECT * FROM client_links").all();
  const linkMap = new Map<string, ClientLink[]>();
  for (const l of allLinks) {
    const list = linkMap.get(l.client_id);
    if (list) list.push(l); else linkMap.set(l.client_id, [l]);
  }

  const allCrmLinks = await prepare<CrmSystem & { client_id: string }>(`
    SELECT ccs.client_id, cs.* FROM crm_systems cs
    JOIN client_crm_systems ccs ON cs.id = ccs.crm_system_id
    ORDER BY cs.position ASC
  `).all();
  const crmMap = new Map<string, CrmSystem[]>();
  for (const row of allCrmLinks) {
    const crm: CrmSystem = { id: row.id, name: row.name, position: row.position };
    const list = crmMap.get(row.client_id);
    if (list) list.push(crm); else crmMap.set(row.client_id, [crm]);
  }

  return clients.map((client) => ({
    ...client,
    status: client.status_id ? statusMap.get(client.status_id) ?? null : null,
    companies: companyMap.get(client.id) ?? [],
    contacts: contactMap.get(client.id) ?? [],
    notes: noteMap.get(client.id) ?? [],
    links: linkMap.get(client.id) ?? [],
    crm_systems: crmMap.get(client.id) ?? [],
  }));
}

export async function createClient(data: {
  id: string; name: string; status_id?: string | null;
  budget?: string; operators_per_shift?: string; operators_total?: string;
  calls_per_month?: string; crm_system?: string;
}): Promise<Client> {
  const now = new Date().toISOString();
  const maxPos = await prepare<{ p: number }>("SELECT COALESCE(MAX(position), -1) + 1 as p FROM clients").get();
  await prepare(`INSERT INTO clients (id, name, status_id, budget, operators_per_shift, operators_total, calls_per_month, crm_system, position, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(data.id, data.name, data.status_id ?? null,
      data.budget ?? "", data.operators_per_shift ?? "", data.operators_total ?? "",
      data.calls_per_month ?? "", data.crm_system ?? "",
      maxPos?.p ?? 0, now, now);
  return (await getClientById(data.id))!;
}

export async function updateClient(id: string, updates: Partial<Omit<Client, "id" | "created_at">>): Promise<Client | undefined> {
  const existing = await getClientById(id);
  if (!existing) return undefined;
  const built = buildUpdateClause(updates as Record<string, unknown>, CLIENT_UPDATE_FIELDS);
  if (!built) return existing;
  const now = new Date().toISOString();
  await prepare(`UPDATE clients SET ${built.sql}, updated_at = ? WHERE id = ?`)
    .run(...built.values, now, id);
  return await getClientById(id);
}

export async function deleteClient(id: string): Promise<boolean> {
  const result = await prepare("DELETE FROM clients WHERE id = ?").run(id);
  return result.changes > 0;
}

export async function reorderClients(updates: { id: string; position: number; status_id?: string }[]): Promise<void> {
  const now = new Date().toISOString();
  await transaction(async (tx) => {
    for (const u of updates) {
      if (u.status_id !== undefined) {
        await tx.prepare("UPDATE clients SET position = ?, status_id = ?, updated_at = ? WHERE id = ?")
          .run(u.position, u.status_id, now, u.id);
      } else {
        await tx.prepare("UPDATE clients SET position = ?, updated_at = ? WHERE id = ?")
          .run(u.position, now, u.id);
      }
    }
  });
}

// ---------------- CRM Systems ----------------

export async function getAllCrmSystems(): Promise<CrmSystem[]> {
  return await prepare<CrmSystem>("SELECT * FROM crm_systems ORDER BY position ASC").all();
}

export async function createCrmSystem(data: { id: string; name: string }): Promise<CrmSystem> {
  const maxPos = await prepare<{ p: number }>("SELECT COALESCE(MAX(position), -1) + 1 as p FROM crm_systems").get();
  await prepare("INSERT INTO crm_systems (id, name, position) VALUES (?, ?, ?)").run(data.id, data.name, maxPos?.p ?? 0);
  return (await prepare<CrmSystem>("SELECT * FROM crm_systems WHERE id = ?").get(data.id))!;
}

export async function updateCrmSystem(id: string, updates: Partial<Pick<CrmSystem, "name" | "position">>): Promise<CrmSystem | undefined> {
  const built = buildUpdateClause(updates as Record<string, unknown>, CRM_SYSTEM_UPDATE_FIELDS);
  if (!built) return await prepare<CrmSystem>("SELECT * FROM crm_systems WHERE id = ?").get(id);
  await prepare(`UPDATE crm_systems SET ${built.sql} WHERE id = ?`).run(...built.values, id);
  return await prepare<CrmSystem>("SELECT * FROM crm_systems WHERE id = ?").get(id);
}

export async function deleteCrmSystem(id: string): Promise<boolean> {
  const result = await prepare("DELETE FROM crm_systems WHERE id = ?").run(id);
  return result.changes > 0;
}

export async function getClientCrmSystems(clientId: string): Promise<CrmSystem[]> {
  return await prepare<CrmSystem>(`
    SELECT cs.* FROM crm_systems cs
    JOIN client_crm_systems ccs ON cs.id = ccs.crm_system_id
    WHERE ccs.client_id = ? ORDER BY cs.position ASC
  `).all(clientId);
}

export async function setClientCrmSystems(clientId: string, crmSystemIds: string[]): Promise<void> {
  await transaction(async (tx) => {
    await tx.prepare("DELETE FROM client_crm_systems WHERE client_id = ?").run(clientId);
    for (const crmId of crmSystemIds) {
      await tx.prepare("INSERT INTO client_crm_systems (client_id, crm_system_id) VALUES (?, ?) ON CONFLICT DO NOTHING").run(clientId, crmId);
    }
  });
}

export async function syncClientNested(clientId: string, data: {
  companies?: { id?: string; name: string }[];
  contacts?: { id?: string; name: string; fields?: { id?: string; type: ContactFieldType; value: string }[] }[];
  notes?: { id?: string; text: string }[];
  links?: { id?: string; url: string; title: string }[];
}): Promise<void> {
  const now = new Date().toISOString();
  await transaction(async (tx) => {
    if (data.companies !== undefined) {
      await tx.prepare("DELETE FROM client_companies WHERE client_id = ?").run(clientId);
      for (const c of data.companies) {
        await tx.prepare("INSERT INTO client_companies (id, client_id, name) VALUES (?, ?, ?)")
          .run(c.id ?? crypto.randomUUID(), clientId, c.name);
      }
    }
    if (data.contacts !== undefined) {
      await tx.prepare("DELETE FROM client_contacts WHERE client_id = ?").run(clientId);
      for (let i = 0; i < data.contacts.length; i++) {
        const contact = data.contacts[i];
        const contactId = contact.id ?? crypto.randomUUID();
        await tx.prepare("INSERT INTO client_contacts (id, client_id, name, position) VALUES (?, ?, ?, ?)")
          .run(contactId, clientId, contact.name, i);
        if (contact.fields) {
          for (const f of contact.fields) {
            await tx.prepare("INSERT INTO client_contact_fields (id, contact_id, type, value) VALUES (?, ?, ?, ?)")
              .run(f.id ?? crypto.randomUUID(), contactId, f.type, f.value);
          }
        }
      }
    }
    if (data.notes !== undefined) {
      await tx.prepare("DELETE FROM client_notes WHERE client_id = ?").run(clientId);
      for (const n of data.notes) {
        await tx.prepare("INSERT INTO client_notes (id, client_id, text, created_at) VALUES (?, ?, ?, ?)")
          .run(n.id ?? crypto.randomUUID(), clientId, n.text, now);
      }
    }
    if (data.links !== undefined) {
      await tx.prepare("DELETE FROM client_links WHERE client_id = ?").run(clientId);
      for (const l of data.links) {
        await tx.prepare("INSERT INTO client_links (id, client_id, url, title) VALUES (?, ?, ?, ?)")
          .run(l.id ?? crypto.randomUUID(), clientId, l.url, l.title);
      }
    }
    await tx.prepare("UPDATE clients SET updated_at = ? WHERE id = ?").run(now, clientId);
  });
}

// ---------------- Relation Types ----------------

export async function getAllRelationTypes(): Promise<RelationType[]> {
  return await prepare<RelationType>("SELECT * FROM relation_types ORDER BY position ASC").all();
}

export async function createRelationType(rt: Pick<RelationType, "id" | "name" | "color" | "icon"> & { is_system?: number }): Promise<RelationType> {
  const maxPos = await prepare<{ p: number }>("SELECT COALESCE(MAX(position), -1) + 1 as p FROM relation_types").get();
  await prepare("INSERT INTO relation_types (id, name, color, icon, position, is_system) VALUES (?, ?, ?, ?, ?, ?)")
    .run(rt.id, rt.name, rt.color, rt.icon, maxPos?.p ?? 0, rt.is_system ?? 0);
  return (await prepare<RelationType>("SELECT * FROM relation_types WHERE id = ?").get(rt.id))!;
}

export async function updateRelationType(id: string, updates: Partial<Pick<RelationType, "name" | "color" | "icon" | "position">>): Promise<RelationType | undefined> {
  const built = buildUpdateClause(updates as Record<string, unknown>, RELATION_TYPE_UPDATE_FIELDS);
  if (!built) return await prepare<RelationType>("SELECT * FROM relation_types WHERE id = ?").get(id);
  await prepare(`UPDATE relation_types SET ${built.sql} WHERE id = ?`).run(...built.values, id);
  return await prepare<RelationType>("SELECT * FROM relation_types WHERE id = ?").get(id);
}

export async function deleteRelationType(id: string): Promise<boolean | "system"> {
  const rt = await prepare<{ is_system: number }>("SELECT is_system FROM relation_types WHERE id = ?").get(id);
  if (rt?.is_system) return "system";
  const result = await prepare("DELETE FROM relation_types WHERE id = ?").run(id);
  return result.changes > 0;
}

// ---------------- Relations ----------------

async function resolveRelationTarget(r: Relation): Promise<RelationWithTarget> {
  let targetTitle = "";
  if (r.target_type === "item") {
    const item = await prepare<{ title: string }>("SELECT title FROM items WHERE id = ?").get(r.target_id);
    targetTitle = item?.title ?? "";
  } else if (r.target_type === "goal") {
    const goal = await prepare<{ title: string }>("SELECT title FROM goals WHERE id = ?").get(r.target_id);
    targetTitle = goal?.title ?? "";
  } else {
    const client = await prepare<{ name: string }>("SELECT name FROM clients WHERE id = ?").get(r.target_id);
    targetTitle = client?.name ?? "";
  }
  const relType = r.relation_type_id
    ? ((await prepare<RelationType>("SELECT * FROM relation_types WHERE id = ?").get(r.relation_type_id)) ?? null)
    : null;
  return { ...r, target_title: targetTitle, relation_type: relType };
}

export async function getRelationsForEntity(entityType: RelationEntityType, entityId: string): Promise<RelationWithTarget[]> {
  const asSource = await prepare<Relation>(
    "SELECT * FROM relations WHERE source_type = ? AND source_id = ? ORDER BY created_at DESC"
  ).all(entityType, entityId);
  const asTarget = await prepare<Relation>(
    "SELECT * FROM relations WHERE target_type = ? AND target_id = ? ORDER BY created_at DESC"
  ).all(entityType, entityId);
  const flipped: Relation[] = asTarget.map((r) => ({
    ...r,
    source_type: r.target_type, source_id: r.target_id,
    target_type: r.source_type, target_id: r.source_id,
  }));
  const all = [...asSource, ...flipped];
  const seen = new Set<string>();
  const unique: Relation[] = [];
  for (const r of all) {
    const key = `${r.target_type}:${r.target_id}`;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(r);
    }
  }
  const resolved: RelationWithTarget[] = [];
  for (const r of unique) resolved.push(await resolveRelationTarget(r));
  return resolved;
}

export async function getRelationCount(entityType: RelationEntityType, entityId: string): Promise<number> {
  const r1 = await prepare<{ c: number }>("SELECT COUNT(*) as c FROM relations WHERE source_type = ? AND source_id = ?").get(entityType, entityId);
  const r2 = await prepare<{ c: number }>("SELECT COUNT(*) as c FROM relations WHERE target_type = ? AND target_id = ?").get(entityType, entityId);
  return Number(r1?.c ?? 0) + Number(r2?.c ?? 0);
}

export async function getRelationCountsBatch(entityType: EntityType): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  const asSource = await prepare<{ source_id: string; c: number }>("SELECT source_id, COUNT(*) as c FROM relations WHERE source_type = ? GROUP BY source_id").all(entityType);
  const asTarget = await prepare<{ target_id: string; c: number }>("SELECT target_id, COUNT(*) as c FROM relations WHERE target_type = ? GROUP BY target_id").all(entityType);
  for (const r of asSource) counts[r.source_id] = (counts[r.source_id] ?? 0) + Number(r.c);
  for (const r of asTarget) counts[r.target_id] = (counts[r.target_id] ?? 0) + Number(r.c);
  return counts;
}

export async function getCommentCountsBatch(entityType: EntityType): Promise<Record<string, number>> {
  const rows = await prepare<{ entity_id: string; c: number }>(
    "SELECT entity_id, COUNT(*) as c FROM comments WHERE entity_type = ? GROUP BY entity_id"
  ).all(entityType);
  const counts: Record<string, number> = {};
  for (const r of rows) counts[r.entity_id] = Number(r.c);
  return counts;
}

export async function getRelationTitlesBatch(entityType: EntityType): Promise<Record<string, string[]>> {
  const result: Record<string, string[]> = {};
  const asSource = await prepare<{ source_id: string; target_type: string; target_id: string }>(
    "SELECT source_id, target_type, target_id FROM relations WHERE source_type = ?"
  ).all(entityType);
  const asTarget = await prepare<{ target_id: string; source_type: string; source_id: string }>(
    "SELECT target_id, source_type, source_id FROM relations WHERE target_type = ?"
  ).all(entityType);

  const allItemTitles = new Map<string, string>();
  for (const row of await prepare<{ id: string; title: string }>("SELECT id, title FROM items").all()) {
    allItemTitles.set(row.id, row.title);
  }
  const allClientNames = new Map<string, string>();
  for (const row of await prepare<{ id: string; name: string }>("SELECT id, name FROM clients").all()) {
    allClientNames.set(row.id, row.name);
  }

  const allGoalTitles = new Map<string, string>();
  for (const row of await prepare<{ id: string; title: string }>("SELECT id, title FROM goals").all()) {
    allGoalTitles.set(row.id, row.title);
  }

  function resolveTitle(type: string, id: string): string {
    if (type === "item") return allItemTitles.get(id) ?? "";
    if (type === "goal") return allGoalTitles.get(id) ?? "";
    return allClientNames.get(id) ?? "";
  }

  for (const r of asSource) {
    const title = resolveTitle(r.target_type, r.target_id);
    if (title) {
      if (!result[r.source_id]) result[r.source_id] = [];
      result[r.source_id].push(title);
    }
  }
  for (const r of asTarget) {
    const title = resolveTitle(r.source_type, r.source_id);
    if (title) {
      if (!result[r.target_id]) result[r.target_id] = [];
      if (!result[r.target_id].includes(title)) result[r.target_id].push(title);
    }
  }
  return result;
}

export async function getItemLinkedClientsBatch(): Promise<Record<string, string[]>> {
  const result: Record<string, string[]> = {};
  const asSource = await prepare<{ item_id: string; client_name: string }>(
    "SELECT r.source_id as item_id, c.name as client_name FROM relations r JOIN clients c ON c.id = r.target_id WHERE r.source_type = 'item' AND r.target_type = 'client'"
  ).all();
  const asTarget = await prepare<{ item_id: string; client_name: string }>(
    "SELECT r.target_id as item_id, c.name as client_name FROM relations r JOIN clients c ON c.id = r.source_id WHERE r.target_type = 'item' AND r.source_type = 'client'"
  ).all();
  for (const row of [...asSource, ...asTarget]) {
    if (!row.client_name) continue;
    if (!result[row.item_id]) result[row.item_id] = [];
    if (!result[row.item_id].includes(row.client_name)) result[row.item_id].push(row.client_name);
  }
  return result;
}

export async function createRelation(data: {
  id: string; source_type: RelationEntityType; source_id: string;
  target_type: RelationEntityType; target_id: string; relation_type_id?: string | null;
}): Promise<Relation | null> {
  const now = new Date().toISOString();
  try {
    await prepare(
      "INSERT INTO relations (id, source_type, source_id, target_type, target_id, relation_type_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).run(data.id, data.source_type, data.source_id, data.target_type, data.target_id, data.relation_type_id ?? null, now);
    return (await prepare<Relation>("SELECT * FROM relations WHERE id = ?").get(data.id)) ?? null;
  } catch {
    return null;
  }
}

export async function updateRelation(id: string, updates: { relation_type_id?: string | null }): Promise<Relation | undefined> {
  if (updates.relation_type_id !== undefined) {
    await prepare("UPDATE relations SET relation_type_id = ? WHERE id = ?").run(updates.relation_type_id, id);
  }
  return await prepare<Relation>("SELECT * FROM relations WHERE id = ?").get(id);
}

export async function deleteRelation(id: string): Promise<boolean> {
  const result = await prepare("DELETE FROM relations WHERE id = ?").run(id);
  return result.changes > 0;
}

// ---------------- Comments ----------------

export async function getComments(entityType: EntityType, entityId: string): Promise<Comment[]> {
  return await prepare<Comment>("SELECT * FROM comments WHERE entity_type = ? AND entity_id = ? ORDER BY created_at ASC").all(entityType, entityId);
}

export async function getCommentCount(entityType: EntityType, entityId: string): Promise<number> {
  const r = await prepare<{ c: number }>("SELECT COUNT(*) as c FROM comments WHERE entity_type = ? AND entity_id = ?").get(entityType, entityId);
  return Number(r?.c ?? 0);
}

export async function createComment(data: {
  id: string; entity_type: EntityType; entity_id: string; text: string; author_email?: string;
}): Promise<Comment> {
  const now = new Date().toISOString();
  await prepare("INSERT INTO comments (id, entity_type, entity_id, text, author_email, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(data.id, data.entity_type, data.entity_id, data.text, data.author_email || "", now, now);
  return (await prepare<Comment>("SELECT * FROM comments WHERE id = ?").get(data.id))!;
}

export async function updateComment(id: string, text: string): Promise<Comment | undefined> {
  const now = new Date().toISOString();
  await prepare("UPDATE comments SET text = ?, updated_at = ? WHERE id = ?").run(text, now, id);
  return await prepare<Comment>("SELECT * FROM comments WHERE id = ?").get(id);
}

export async function deleteComment(id: string): Promise<boolean> {
  const result = await prepare("DELETE FROM comments WHERE id = ?").run(id);
  return result.changes > 0;
}

// ---------------- Goals ----------------

import type {
  Goal, GoalMetric, GoalMetricSnapshot, GoalLevel, GoalAxis, GoalStatus,
  GoalAxisConfig, CreateGoalAxisPayload, UpdateGoalAxisPayload,
  CreateGoalPayload, UpdateGoalPayload, CreateMetricPayload, UpdateMetricPayload, MetricPayload,
} from "@/types";

// ---------------- Goal axes (user-managed axis tags) ----------------

const GOAL_AXIS_UPDATE_FIELDS = ["name", "color", "bg", "icon", "position"] as const;

export async function getGoalAxes(): Promise<GoalAxisConfig[]> {
  return await prepare<GoalAxisConfig>(
    "SELECT * FROM goal_axes ORDER BY position ASC, name ASC"
  ).all();
}

export async function getGoalAxisById(id: string): Promise<GoalAxisConfig | undefined> {
  return await prepare<GoalAxisConfig>("SELECT * FROM goal_axes WHERE id = ?").get(id);
}

export async function createGoalAxis(data: CreateGoalAxisPayload & { id: string }): Promise<GoalAxisConfig> {
  const maxPos = await prepare<{ p: number }>(
    "SELECT COALESCE(MAX(position), -1) + 1 as p FROM goal_axes"
  ).get();
  const position = data.position ?? Number(maxPos?.p ?? 0);
  await prepare(
    `INSERT INTO goal_axes (id, name, color, bg, icon, position, is_system)
     VALUES (?, ?, ?, ?, ?, ?, 0)`
  ).run(
    data.id, data.name.trim(),
    data.color ?? "#64748b", data.bg ?? "#f1f5f9",
    data.icon ?? "◆", position,
  );
  return (await getGoalAxisById(data.id))!;
}

export async function updateGoalAxis(id: string, updates: UpdateGoalAxisPayload): Promise<GoalAxisConfig | undefined> {
  const built = buildUpdateClause(updates as Record<string, unknown>, GOAL_AXIS_UPDATE_FIELDS);
  if (!built) return await getGoalAxisById(id);
  await prepare(`UPDATE goal_axes SET ${built.sql}, updated_at = ? WHERE id = ?`)
    .run(...built.values, new Date().toISOString(), id);
  return await getGoalAxisById(id);
}

export async function deleteGoalAxis(id: string): Promise<{ ok: boolean; reason?: string }> {
  const axis = await getGoalAxisById(id);
  if (!axis) return { ok: false, reason: "not_found" };
  if (axis.is_system) return { ok: false, reason: "system" };
  // Detach axis from any goals that reference it.
  await prepare("UPDATE goals SET axis = NULL WHERE axis = ?").run(id);
  await prepare("DELETE FROM goal_axes WHERE id = ?").run(id);
  return { ok: true };
}

const GOAL_UPDATE_FIELDS = [
  "parent_id", "level", "axis", "title", "description", "status",
  "period_start", "period_end", "position",
] as const;

const METRIC_UPDATE_FIELDS = [
  "title", "unit", "target_value", "current_value", "start_value",
  "direction", "payload", "weight", "position",
] as const;

type GoalRow = Omit<Goal, never>;
type MetricRow = Omit<GoalMetric, "payload" | "tasks_done" | "tasks_total"> & { payload: unknown };

function mapMetric(row: MetricRow): GoalMetric {
  let payload: MetricPayload | null = null;
  if (row.payload != null) {
    payload = typeof row.payload === "string" ? JSON.parse(row.payload) : (row.payload as MetricPayload);
  }
  return {
    id: row.id,
    goal_id: row.goal_id,
    kind: row.kind,
    title: row.title,
    unit: row.unit,
    target_value: row.target_value == null ? null : Number(row.target_value),
    current_value: row.current_value == null ? null : Number(row.current_value),
    start_value: row.start_value == null ? null : Number(row.start_value),
    direction: row.direction,
    payload,
    weight: Number(row.weight ?? 1),
    position: Number(row.position ?? 0),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export async function getAllGoals(filters?: {
  level?: GoalLevel; axis?: GoalAxis; parent_id?: string | null; status?: GoalStatus;
}): Promise<Goal[]> {
  const where: string[] = [];
  const values: unknown[] = [];
  if (filters?.level) { where.push("level = ?"); values.push(filters.level); }
  if (filters?.axis) { where.push("axis = ?"); values.push(filters.axis); }
  if (filters?.parent_id !== undefined) {
    if (filters.parent_id === null) where.push("parent_id IS NULL");
    else { where.push("parent_id = ?"); values.push(filters.parent_id); }
  }
  if (filters?.status) { where.push("status = ?"); values.push(filters.status); }
  const sql = `SELECT * FROM goals${where.length ? " WHERE " + where.join(" AND ") : ""} ORDER BY position ASC, created_at ASC`;
  return await prepare<GoalRow>(sql).all(...values);
}

export async function getGoalById(id: string): Promise<Goal | undefined> {
  return await prepare<GoalRow>("SELECT * FROM goals WHERE id = ?").get(id);
}

export async function createGoal(data: CreateGoalPayload & { id: string }): Promise<Goal> {
  const maxPos = await prepare<{ p: number }>(
    `SELECT COALESCE(MAX(position), -1) + 1 as p FROM goals WHERE ${data.parent_id ? "parent_id = ?" : "parent_id IS NULL"}`
  ).get(...(data.parent_id ? [data.parent_id] : []));
  const position = data.position ?? Number(maxPos?.p ?? 0);
  await prepare(
    `INSERT INTO goals (id, parent_id, level, axis, title, description, status, period_start, period_end, position)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    data.id, data.parent_id ?? null, data.level, data.axis ?? null,
    data.title.trim(), data.description ?? "", data.status ?? "active",
    data.period_start ?? null, data.period_end ?? null, position,
  );
  return (await getGoalById(data.id))!;
}

export async function updateGoal(id: string, updates: UpdateGoalPayload): Promise<Goal | undefined> {
  const built = buildUpdateClause(updates as Record<string, unknown>, GOAL_UPDATE_FIELDS);
  if (!built) return await getGoalById(id);
  await prepare(`UPDATE goals SET ${built.sql}, updated_at = ? WHERE id = ?`).run(...built.values, new Date().toISOString(), id);
  return await getGoalById(id);
}

export async function deleteGoal(id: string): Promise<boolean> {
  const result = await prepare("DELETE FROM goals WHERE id = ?").run(id);
  return result.changes > 0;
}

export async function getGoalsChildrenCounts(): Promise<Map<string, number>> {
  const rows = await prepare<{ parent_id: string; c: number }>(
    "SELECT parent_id, COUNT(*) as c FROM goals WHERE parent_id IS NOT NULL GROUP BY parent_id"
  ).all();
  const m = new Map<string, number>();
  for (const r of rows) m.set(r.parent_id, Number(r.c));
  return m;
}

// ---------------- Goal metrics ----------------

export async function getMetricsForGoal(goalId: string): Promise<GoalMetric[]> {
  const rows = await prepare<MetricRow>(
    "SELECT * FROM goal_metrics WHERE goal_id = ? ORDER BY position ASC, created_at ASC"
  ).all(goalId);
  const metrics = rows.map(mapMetric);
  await fillTaskMetricCounts(metrics);
  return metrics;
}

export async function getMetricsForGoals(goalIds: string[]): Promise<Map<string, GoalMetric[]>> {
  const out = new Map<string, GoalMetric[]>();
  if (goalIds.length === 0) return out;
  const placeholders = goalIds.map(() => "?").join(",");
  const rows = await prepare<MetricRow>(
    `SELECT * FROM goal_metrics WHERE goal_id IN (${placeholders}) ORDER BY position ASC, created_at ASC`
  ).all(...goalIds);
  const metrics = rows.map(mapMetric);
  await fillTaskMetricCounts(metrics);
  for (const m of metrics) {
    const arr = out.get(m.goal_id) ?? [];
    arr.push(m);
    out.set(m.goal_id, arr);
  }
  return out;
}

// For all `tasks` KRs, count linked items via relations. Fills tasks_done/tasks_total in-place.
async function fillTaskMetricCounts(metrics: GoalMetric[]): Promise<void> {
  const taskMetrics = metrics.filter((m) => m.kind === "tasks");
  if (taskMetrics.length === 0) return;
  const goalIds = Array.from(new Set(taskMetrics.map((m) => m.goal_id)));
  const placeholders = goalIds.map(() => "?").join(",");
  const rows = await prepare<{ goal_id: string; status: string; c: number }>(
    `SELECT r.source_id as goal_id, i.status as status, COUNT(*) as c
       FROM relations r JOIN items i ON i.id = r.target_id
      WHERE r.source_type = 'goal' AND r.target_type = 'item'
        AND r.relation_type_id = 'belongs_to_goal'
        AND r.source_id IN (${placeholders})
      GROUP BY r.source_id, i.status`
  ).all(...goalIds);
  const totals = new Map<string, { done: number; total: number }>();
  for (const r of rows) {
    const cur = totals.get(r.goal_id) ?? { done: 0, total: 0 };
    cur.total += Number(r.c);
    if (r.status === "done") cur.done += Number(r.c);
    totals.set(r.goal_id, cur);
  }
  for (const m of taskMetrics) {
    const t = totals.get(m.goal_id) ?? { done: 0, total: 0 };
    m.tasks_done = t.done;
    m.tasks_total = t.total;
  }
}

export async function createMetric(data: CreateMetricPayload & { id: string; goal_id: string }): Promise<GoalMetric> {
  const maxPos = await prepare<{ p: number }>(
    "SELECT COALESCE(MAX(position), -1) + 1 as p FROM goal_metrics WHERE goal_id = ?"
  ).get(data.goal_id);
  const position = data.position ?? Number(maxPos?.p ?? 0);
  await prepare(
    `INSERT INTO goal_metrics (id, goal_id, kind, title, unit, target_value, current_value, start_value,
                                direction, payload, weight, position)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    data.id, data.goal_id, data.kind, data.title.trim(),
    data.unit ?? null, data.target_value ?? null, data.current_value ?? null, data.start_value ?? null,
    data.direction ?? "up", data.payload ? JSON.stringify(data.payload) : null,
    data.weight ?? 1, position,
  );
  const created = await prepare<MetricRow>("SELECT * FROM goal_metrics WHERE id = ?").get(data.id);
  const metric = mapMetric(created!);
  if (metric.kind === "tasks") await fillTaskMetricCounts([metric]);
  return metric;
}

export async function updateMetric(id: string, updates: UpdateMetricPayload): Promise<GoalMetric | undefined> {
  const normalized: Record<string, unknown> = { ...updates };
  if (Object.prototype.hasOwnProperty.call(normalized, "payload")) {
    normalized.payload = normalized.payload == null ? null : JSON.stringify(normalized.payload);
  }
  const built = buildUpdateClause(normalized, METRIC_UPDATE_FIELDS);
  if (!built) {
    const row = await prepare<MetricRow>("SELECT * FROM goal_metrics WHERE id = ?").get(id);
    return row ? mapMetric(row) : undefined;
  }
  await prepare(`UPDATE goal_metrics SET ${built.sql}, updated_at = ? WHERE id = ?`).run(
    ...built.values, new Date().toISOString(), id,
  );
  const row = await prepare<MetricRow>("SELECT * FROM goal_metrics WHERE id = ?").get(id);
  if (!row) return undefined;
  const metric = mapMetric(row);
  if (metric.kind === "tasks") await fillTaskMetricCounts([metric]);
  return metric;
}

export async function deleteMetric(id: string): Promise<boolean> {
  const result = await prepare("DELETE FROM goal_metrics WHERE id = ?").run(id);
  return result.changes > 0;
}

export async function recordMetricSnapshot(data: {
  id: string; metric_id: string; value: number; note?: string;
}): Promise<GoalMetricSnapshot> {
  const now = new Date().toISOString();
  await prepare(
    "INSERT INTO goal_metric_snapshots (id, metric_id, value, recorded_at, note) VALUES (?, ?, ?, ?, ?)"
  ).run(data.id, data.metric_id, data.value, now, data.note ?? "");
  await prepare("UPDATE goal_metrics SET current_value = ?, updated_at = ? WHERE id = ?")
    .run(data.value, now, data.metric_id);
  return (await prepare<GoalMetricSnapshot>("SELECT * FROM goal_metric_snapshots WHERE id = ?").get(data.id))!;
}

export async function getMetricSnapshots(metricId: string, limit = 50): Promise<GoalMetricSnapshot[]> {
  return await prepare<GoalMetricSnapshot>(
    "SELECT * FROM goal_metric_snapshots WHERE metric_id = ? ORDER BY recorded_at DESC LIMIT ?"
  ).all(metricId, limit);
}

// ---------------- Integrations ----------------

export async function getIntegrationSettings(provider: IntegrationProvider = "kaiten"): Promise<IntegrationSettings> {
  const row = await prepare<{
    provider: string; enabled: number; company_domain: string; api_base_url: string;
    token_secret: string; default_import_target: "staging"; created_at: string; updated_at: string;
  }>("SELECT * FROM integration_settings WHERE provider = ?").get(provider);
  return mapIntegrationSettings(row);
}

export async function getIntegrationToken(provider: IntegrationProvider = "kaiten"): Promise<string> {
  const row = await prepare<{ token_secret: string }>("SELECT token_secret FROM integration_settings WHERE provider = ?").get(provider);
  return row?.token_secret ?? "";
}

export async function upsertIntegrationSettings(provider: IntegrationProvider, input: IntegrationSettingsInput): Promise<IntegrationSettings> {
  const now = new Date().toISOString();
  const existing = await prepare<{ token_secret: string }>("SELECT * FROM integration_settings WHERE provider = ?").get(provider);
  const companyDomain = input.company_domain.trim().replace(/^https?:\/\//, "").replace(/\.kaiten\.ru\/?$/, "");
  const tokenSecret = input.clear_token ? "" : (input.token !== undefined ? input.token.trim() : existing?.token_secret ?? "");
  const apiBaseUrl = buildApiBaseUrl(companyDomain);
  await prepare(`
    INSERT INTO integration_settings (provider, enabled, company_domain, api_base_url, token_secret, default_import_target, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'staging', ?, ?)
    ON CONFLICT(provider) DO UPDATE SET
      enabled = excluded.enabled,
      company_domain = excluded.company_domain,
      api_base_url = excluded.api_base_url,
      token_secret = excluded.token_secret,
      default_import_target = excluded.default_import_target,
      updated_at = excluded.updated_at
  `).run(provider, input.enabled ? 1 : 0, companyDomain, apiBaseUrl, tokenSecret, now, now);
  return await getIntegrationSettings(provider);
}

function mapSyncProfile(row: {
  id: string; provider: string; name: string; entity_type: SyncEntityType;
  source_space_id: number | null; source_board_id: number | null;
  import_enabled: number; export_enabled: number; sync_interval_minutes: number; remote_wins_on_conflict: number;
  source_statuses: string; source_columns: string; source_lanes: string;
  available_development_stages: string; available_participants: string;
  last_catalog_synced_at: string | null; created_at: string; updated_at: string;
}): SyncProfile {
  return {
    id: row.id,
    provider: row.provider as IntegrationProvider,
    name: row.name,
    entity_type: row.entity_type,
    source_space_id: row.source_space_id,
    source_board_id: row.source_board_id,
    import_enabled: !!row.import_enabled,
    export_enabled: !!row.export_enabled,
    sync_interval_minutes: row.sync_interval_minutes ?? 60,
    remote_wins_on_conflict: row.remote_wins_on_conflict !== 0,
    source_statuses: parseJsonArray(row.source_statuses),
    source_columns: parseJsonArray(row.source_columns),
    source_lanes: parseJsonArray(row.source_lanes),
    available_development_stages: parseJsonValue<KaitenStageOption[]>(row.available_development_stages, []),
    available_participants: parseJsonValue<DevelopmentParticipantInput[]>(row.available_participants, []),
    last_catalog_synced_at: row.last_catalog_synced_at ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

type SyncProfileRow = Parameters<typeof mapSyncProfile>[0];

export async function getAllSyncProfiles(provider: IntegrationProvider = "kaiten"): Promise<SyncProfile[]> {
  const rows = await prepare<SyncProfileRow>("SELECT * FROM sync_profiles WHERE provider = ? ORDER BY created_at ASC").all(provider);
  return rows.map(mapSyncProfile);
}

export async function getSyncProfileById(id: string): Promise<SyncProfile | undefined> {
  const row = await prepare<SyncProfileRow>("SELECT * FROM sync_profiles WHERE id = ?").get(id);
  return row ? mapSyncProfile(row) : undefined;
}

export async function upsertSyncProfile(provider: IntegrationProvider, input: SyncProfileInput): Promise<SyncProfile> {
  const now = new Date().toISOString();
  const id = input.id ?? crypto.randomUUID();
  await prepare(`
    INSERT INTO sync_profiles (
      id, provider, name, entity_type, source_space_id, source_board_id,
      import_enabled, export_enabled, sync_interval_minutes, remote_wins_on_conflict,
      source_statuses, source_columns, source_lanes,
      available_development_stages, available_participants, last_catalog_synced_at,
      created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      entity_type = excluded.entity_type,
      source_space_id = excluded.source_space_id,
      source_board_id = excluded.source_board_id,
      import_enabled = excluded.import_enabled,
      export_enabled = excluded.export_enabled,
      sync_interval_minutes = excluded.sync_interval_minutes,
      remote_wins_on_conflict = excluded.remote_wins_on_conflict,
      source_statuses = excluded.source_statuses,
      source_columns = excluded.source_columns,
      source_lanes = excluded.source_lanes,
      available_development_stages = excluded.available_development_stages,
      available_participants = excluded.available_participants,
      last_catalog_synced_at = excluded.last_catalog_synced_at,
      updated_at = excluded.updated_at
  `).run(
    id, provider, input.name.trim(), input.entity_type ?? "item",
    input.source_space_id ?? null, input.source_board_id ?? null,
    input.import_enabled === false ? 0 : 1,
    input.export_enabled ? 1 : 0,
    Math.max(5, input.sync_interval_minutes ?? 60),
    input.remote_wins_on_conflict === false ? 0 : 1,
    JSON.stringify(input.source_statuses ?? []),
    JSON.stringify(input.source_columns ?? []),
    JSON.stringify(input.source_lanes ?? []),
    JSON.stringify(input.available_development_stages ?? []),
    JSON.stringify(input.available_participants ?? []),
    input.last_catalog_synced_at ?? null,
    now, now
  );
  return (await getSyncProfileById(id))!;
}

export function mapSyncField(row: {
  id: string; profile_id: string; local_entity_type: SyncEntityType;
  local_field: string; remote_field: string; direction: SyncDirection;
  transform_rule: string | null; created_at: string; updated_at: string;
}): SyncFieldMapping {
  return {
    id: row.id, profile_id: row.profile_id, local_entity_type: row.local_entity_type,
    local_field: row.local_field, remote_field: row.remote_field, direction: row.direction,
    transform_rule: row.transform_rule, created_at: row.created_at, updated_at: row.updated_at,
  };
}

type SyncFieldRow = Parameters<typeof mapSyncField>[0];

export async function getSyncFieldMappings(profileId: string): Promise<SyncFieldMapping[]> {
  const rows = await prepare<SyncFieldRow>("SELECT * FROM sync_field_mappings WHERE profile_id = ? ORDER BY created_at ASC").all(profileId);
  return rows.map(mapSyncField);
}

export async function replaceSyncFieldMappings(profileId: string, mappings: SyncFieldMappingInput[]): Promise<SyncFieldMapping[]> {
  const now = new Date().toISOString();
  await transaction(async (tx) => {
    await tx.prepare("DELETE FROM sync_field_mappings WHERE profile_id = ?").run(profileId);
    for (const mapping of mappings) {
      await tx.prepare(`
        INSERT INTO sync_field_mappings (
          id, profile_id, local_entity_type, local_field, remote_field, direction, transform_rule, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        mapping.id ?? crypto.randomUUID(), profileId,
        mapping.local_entity_type ?? "item",
        mapping.local_field, mapping.remote_field,
        mapping.direction ?? "import",
        mapping.transform_rule ?? null, now, now
      );
    }
  });
  return await getSyncFieldMappings(profileId);
}

function mapExternalEntityLink(row: {
  id: string; provider: string; profile_id: string | null;
  local_entity_type: SyncEntityType; local_entity_id: string;
  remote_entity_type: string; remote_entity_id: string;
  remote_space_id: number | null; remote_board_id: number | null;
  remote_column_id: number | null; remote_lane_id: number | null;
  last_remote_updated_at: string | null; last_local_synced_at: string | null;
  sync_state: ExternalSyncState; last_error: string | null;
  created_at: string; updated_at: string;
}): ExternalEntityLink {
  return {
    id: row.id, provider: row.provider as IntegrationProvider, profile_id: row.profile_id,
    local_entity_type: row.local_entity_type, local_entity_id: row.local_entity_id,
    remote_entity_type: row.remote_entity_type, remote_entity_id: row.remote_entity_id,
    remote_space_id: row.remote_space_id, remote_board_id: row.remote_board_id,
    remote_column_id: row.remote_column_id, remote_lane_id: row.remote_lane_id,
    last_remote_updated_at: row.last_remote_updated_at,
    last_local_synced_at: row.last_local_synced_at,
    sync_state: row.sync_state, last_error: row.last_error,
    created_at: row.created_at, updated_at: row.updated_at,
  };
}

type ExternalLinkRow = Parameters<typeof mapExternalEntityLink>[0];

export async function getExternalEntityLinkByRemote(provider: IntegrationProvider, remoteEntityType: string, remoteEntityId: string): Promise<ExternalEntityLink | undefined> {
  const row = await prepare<ExternalLinkRow>(
    "SELECT * FROM external_entity_links WHERE provider = ? AND remote_entity_type = ? AND remote_entity_id = ?"
  ).get(provider, remoteEntityType, remoteEntityId);
  return row ? mapExternalEntityLink(row) : undefined;
}

export async function getExternalEntityLinkByLocal(provider: IntegrationProvider, localEntityType: SyncEntityType, localEntityId: string): Promise<ExternalEntityLink | undefined> {
  const row = await prepare<ExternalLinkRow>(
    "SELECT * FROM external_entity_links WHERE provider = ? AND local_entity_type = ? AND local_entity_id = ?"
  ).get(provider, localEntityType, localEntityId);
  return row ? mapExternalEntityLink(row) : undefined;
}

export async function upsertExternalEntityLink(input: {
  provider: IntegrationProvider; profile_id?: string | null;
  local_entity_type: SyncEntityType; local_entity_id: string;
  remote_entity_type: string; remote_entity_id: string;
  remote_space_id?: number | null; remote_board_id?: number | null;
  remote_column_id?: number | null; remote_lane_id?: number | null;
  last_remote_updated_at?: string | null; last_local_synced_at?: string | null;
  sync_state?: ExternalSyncState; last_error?: string | null;
}): Promise<ExternalEntityLink> {
  const existing = await getExternalEntityLinkByRemote(input.provider, input.remote_entity_type, input.remote_entity_id);
  const id = existing?.id ?? crypto.randomUUID();
  const createdAt = existing?.created_at ?? new Date().toISOString();
  const now = new Date().toISOString();

  await prepare(`
    INSERT INTO external_entity_links (
      id, provider, profile_id, local_entity_type, local_entity_id, remote_entity_type, remote_entity_id,
      remote_space_id, remote_board_id, remote_column_id, remote_lane_id,
      last_remote_updated_at, last_local_synced_at, sync_state, last_error, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(provider, remote_entity_type, remote_entity_id) DO UPDATE SET
      profile_id = excluded.profile_id,
      local_entity_type = excluded.local_entity_type,
      local_entity_id = excluded.local_entity_id,
      remote_space_id = excluded.remote_space_id,
      remote_board_id = excluded.remote_board_id,
      remote_column_id = excluded.remote_column_id,
      remote_lane_id = excluded.remote_lane_id,
      last_remote_updated_at = excluded.last_remote_updated_at,
      last_local_synced_at = excluded.last_local_synced_at,
      sync_state = excluded.sync_state,
      last_error = excluded.last_error,
      updated_at = excluded.updated_at
  `).run(
    id, input.provider,
    input.profile_id ?? existing?.profile_id ?? null,
    input.local_entity_type, input.local_entity_id,
    input.remote_entity_type, input.remote_entity_id,
    input.remote_space_id ?? null, input.remote_board_id ?? null,
    input.remote_column_id ?? null, input.remote_lane_id ?? null,
    input.last_remote_updated_at ?? null,
    input.last_local_synced_at ?? null,
    input.sync_state ?? "pending",
    input.last_error ?? null,
    createdAt, now
  );

  return (await getExternalEntityLinkByRemote(input.provider, input.remote_entity_type, input.remote_entity_id))!;
}

export async function rebindExternalEntityLinks(localEntityType: SyncEntityType, oldLocalEntityId: string, newLocalEntityId: string): Promise<void> {
  const now = new Date().toISOString();
  await prepare(`
    UPDATE external_entity_links
    SET local_entity_id = ?, sync_state = 'active', last_local_synced_at = ?, updated_at = ?
    WHERE local_entity_type = ? AND local_entity_id = ?
  `).run(newLocalEntityId, now, now, localEntityType, oldLocalEntityId);
}

export async function saveSyncImportRun(provider: IntegrationProvider, profileId: string, result: KaitenImportResult): Promise<void> {
  const now = new Date().toISOString();
  await prepare(`
    INSERT INTO sync_import_runs (id, provider, profile_id, batch_id, stats_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(crypto.randomUUID(), provider, profileId, result.batch_id, JSON.stringify(result), now);
}

export async function getLatestSyncImportRun(profileId: string): Promise<KaitenImportResult | null> {
  const row = await prepare<{ stats_json: string }>(
    "SELECT stats_json FROM sync_import_runs WHERE profile_id = ? ORDER BY created_at DESC LIMIT 1"
  ).get(profileId);
  if (!row?.stats_json) return null;
  try { return JSON.parse(row.stats_json) as KaitenImportResult; } catch { return null; }
}

export async function getSyncProfileByBoard(provider: IntegrationProvider, boardId: number): Promise<SyncProfile | undefined> {
  const row = await prepare<SyncProfileRow>(
    "SELECT * FROM sync_profiles WHERE provider = ? AND source_board_id = ? ORDER BY export_enabled DESC, created_at ASC LIMIT 1"
  ).get(provider, boardId);
  return row ? mapSyncProfile(row) : undefined;
}

export async function getKaitenSyncCatalog(): Promise<{
  development_stages: KaitenStageOption[];
  participants: DevelopmentParticipantInput[];
  profiles: Array<{
    profile_id: string; profile_name: string; board_id: number | null;
    development_stages: KaitenStageOption[]; participants: DevelopmentParticipantInput[];
    last_catalog_synced_at: string | null;
  }>;
}> {
  const profiles = await getAllSyncProfiles("kaiten");
  const stagesMap = new Map<string, KaitenStageOption>();
  const participantsMap = new Map<string, DevelopmentParticipantInput>();
  for (const profile of profiles) {
    for (const stage of profile.available_development_stages) stagesMap.set(stage.value, stage);
    for (const participant of profile.available_participants) {
      const key = participant.remote_id ?? participant.name;
      participantsMap.set(key, participant);
    }
  }
  return {
    development_stages: Array.from(stagesMap.values()).sort((a, b) => a.label.localeCompare(b.label, "ru")),
    participants: Array.from(participantsMap.values()).sort((a, b) => a.name.localeCompare(b.name, "ru")),
    profiles: profiles.map((profile) => ({
      profile_id: profile.id,
      profile_name: profile.name,
      board_id: profile.source_board_id,
      development_stages: profile.available_development_stages,
      participants: profile.available_participants,
      last_catalog_synced_at: profile.last_catalog_synced_at,
    })),
  };
}

// ---------------- Sync Outbox ----------------

type SyncOutboxRow = {
  id: string; provider: string; profile_id: string | null;
  local_entity_type: SyncEntityType; local_entity_id: string;
  remote_entity_type: string; remote_entity_id: string;
  status: SyncOutboxStatus; attempts: number;
  requested_at: string; next_attempt_at: string;
  last_error: string | null; created_at: string; updated_at: string;
};

function mapSyncOutbox(row: SyncOutboxRow): SyncOutboxJob {
  return {
    id: row.id, provider: row.provider as IntegrationProvider,
    profile_id: row.profile_id,
    local_entity_type: row.local_entity_type, local_entity_id: row.local_entity_id,
    remote_entity_type: row.remote_entity_type, remote_entity_id: row.remote_entity_id,
    status: row.status, attempts: row.attempts,
    requested_at: row.requested_at, next_attempt_at: row.next_attempt_at,
    last_error: row.last_error, created_at: row.created_at, updated_at: row.updated_at,
  };
}

export async function upsertSyncOutboxJob(input: {
  provider: IntegrationProvider; profile_id?: string | null;
  local_entity_type: SyncEntityType; local_entity_id: string;
  remote_entity_type: string; remote_entity_id: string;
  next_attempt_at: string; last_error?: string | null;
}): Promise<SyncOutboxJob> {
  const now = new Date().toISOString();
  const existing = await prepare<{ id: string; created_at: string }>(
    "SELECT * FROM sync_outbox WHERE provider = ? AND local_entity_type = ? AND local_entity_id = ?"
  ).get(input.provider, input.local_entity_type, input.local_entity_id);
  const id = existing?.id ?? crypto.randomUUID();
  const createdAt = existing?.created_at ?? now;

  await prepare(`
    INSERT INTO sync_outbox (
      id, provider, profile_id, local_entity_type, local_entity_id, remote_entity_type, remote_entity_id,
      status, attempts, requested_at, next_attempt_at, last_error, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', 0, ?, ?, ?, ?, ?)
    ON CONFLICT(provider, local_entity_type, local_entity_id) DO UPDATE SET
      profile_id = excluded.profile_id,
      remote_entity_type = excluded.remote_entity_type,
      remote_entity_id = excluded.remote_entity_id,
      status = 'pending',
      requested_at = excluded.requested_at,
      next_attempt_at = excluded.next_attempt_at,
      last_error = excluded.last_error,
      updated_at = excluded.updated_at
  `).run(
    id, input.provider, input.profile_id ?? null,
    input.local_entity_type, input.local_entity_id,
    input.remote_entity_type, input.remote_entity_id,
    now, input.next_attempt_at, input.last_error ?? null,
    createdAt, now
  );
  return (await getSyncOutboxJobByLocal(input.provider, input.local_entity_type, input.local_entity_id))!;
}

export async function getSyncOutboxJobByLocal(provider: IntegrationProvider, localEntityType: SyncEntityType, localEntityId: string): Promise<SyncOutboxJob | undefined> {
  const row = await prepare<SyncOutboxRow>(
    "SELECT * FROM sync_outbox WHERE provider = ? AND local_entity_type = ? AND local_entity_id = ?"
  ).get(provider, localEntityType, localEntityId);
  return row ? mapSyncOutbox(row) : undefined;
}

export async function getDueSyncOutboxJobs(provider: IntegrationProvider, limit = 50, includeFuture = false): Promise<SyncOutboxJob[]> {
  const rows = includeFuture
    ? await prepare<SyncOutboxRow>(`
        SELECT * FROM sync_outbox
        WHERE provider = ? AND status IN ('pending', 'error')
        ORDER BY requested_at ASC
        LIMIT ?
      `).all(provider, limit)
    : await prepare<SyncOutboxRow>(`
        SELECT * FROM sync_outbox
        WHERE provider = ? AND status IN ('pending', 'error') AND next_attempt_at <= ?
        ORDER BY next_attempt_at ASC
        LIMIT ?
      `).all(provider, new Date().toISOString(), limit);
  return rows.map(mapSyncOutbox);
}

export async function markSyncOutboxProcessing(id: string): Promise<void> {
  await prepare("UPDATE sync_outbox SET status = 'processing', attempts = attempts + 1, updated_at = ? WHERE id = ?").run(new Date().toISOString(), id);
}

export async function markSyncOutboxError(id: string, nextAttemptAt: string, lastError: string): Promise<void> {
  await prepare("UPDATE sync_outbox SET status = 'error', next_attempt_at = ?, last_error = ?, updated_at = ? WHERE id = ?").run(nextAttemptAt, lastError, new Date().toISOString(), id);
}

export async function deleteSyncOutboxJob(id: string): Promise<void> {
  await prepare("DELETE FROM sync_outbox WHERE id = ?").run(id);
}

// ---------------- Staging ----------------

export async function getAllStagingItems(status?: StagingStatus): Promise<StagingItem[]> {
  if (status) {
    return await prepare<StagingItem>("SELECT * FROM staging_items WHERE staging_status = ? ORDER BY created_at DESC").all(status);
  }
  return await prepare<StagingItem>("SELECT * FROM staging_items ORDER BY created_at DESC").all();
}

export async function getStagingItemById(id: string): Promise<StagingItem | undefined> {
  return await prepare<StagingItem>("SELECT * FROM staging_items WHERE id = ?").get(id);
}

export async function createStagingItem(item: {
  id: string; entity_type: StagingEntityType; title: string;
  description: string; parsed_data: string; batch_id: string;
}): Promise<StagingItem> {
  const now = new Date().toISOString();
  await prepare(`
    INSERT INTO staging_items (id, entity_type, title, description, parsed_data, staging_status, batch_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?)
  `).run(item.id, item.entity_type, item.title, item.description, item.parsed_data, item.batch_id, now, now);
  return (await prepare<StagingItem>("SELECT * FROM staging_items WHERE id = ?").get(item.id))!;
}

export async function updateStagingItem(id: string, updates: Partial<Pick<StagingItem, "title" | "description" | "parsed_data" | "staging_status" | "entity_type" | "batch_id">>): Promise<StagingItem | undefined> {
  const built = buildUpdateClause(updates as Record<string, unknown>, STAGING_ITEM_UPDATE_FIELDS);
  if (!built) return await getStagingItemById(id);
  const now = new Date().toISOString();
  await prepare(`UPDATE staging_items SET ${built.sql}, updated_at = ? WHERE id = ?`)
    .run(...built.values, now, id);
  return await getStagingItemById(id);
}

export async function deleteStagingItem(id: string): Promise<boolean> {
  const result = await prepare("DELETE FROM staging_items WHERE id = ?").run(id);
  return result.changes > 0;
}

export async function deleteStagingBatch(batchId: string): Promise<boolean> {
  const result = await prepare("DELETE FROM staging_items WHERE batch_id = ?").run(batchId);
  return result.changes > 0;
}

export async function approveStagingItem(id: string): Promise<StagingItem | undefined> {
  return await updateStagingItem(id, { staging_status: "approved" });
}

export async function rejectStagingItem(id: string): Promise<StagingItem | undefined> {
  return await updateStagingItem(id, { staging_status: "rejected" });
}

// ---------------- Users ----------------

export async function getUserByEmail(email: string): Promise<User | undefined> {
  return await prepare<User>("SELECT * FROM users WHERE email = ?").get(email);
}

export async function getAllUsers(): Promise<User[]> {
  return await prepare<User>("SELECT * FROM users ORDER BY created_at ASC").all();
}

export async function upsertUser(email: string, role: UserRole, name?: string): Promise<User> {
  const now = new Date().toISOString();
  await prepare(`
    INSERT INTO users (email, role, name, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(email) DO UPDATE SET
      role = excluded.role,
      name = excluded.name,
      updated_at = excluded.updated_at
  `).run(email, role, name ?? "", now, now);
  return (await getUserByEmail(email))!;
}

export async function deleteUser(email: string): Promise<boolean> {
  const result = await prepare("DELETE FROM users WHERE email = ?").run(email);
  return result.changes > 0;
}

export async function getUserCount(): Promise<number> {
  const r = await prepare<{ c: number }>("SELECT COUNT(*) as c FROM users").get();
  return Number(r?.c ?? 0);
}
