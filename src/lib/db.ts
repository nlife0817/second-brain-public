import { prepare, transaction } from "./sql";
import {
  User, UserRole,
  Item, ItemWithSubtasks, Tag, Category, CrmSystem,
  Client, ClientFull, ClientStatus, ClientCompany, ClientContact, ClientContactField, ClientNote, ClientLink,
  ContactFieldType,
  RelationType, Relation, RelationWithTarget, Comment, EntityType, RelationEntityType,
  StagingItem, StagingEntityType, StagingStatus,
  IntegrationProvider, IntegrationSettings, IntegrationSettingsInput,
  SyncProfile, SyncProfileInput, SyncFieldMapping, SyncFieldMappingInput,
  ExternalEntityLink, ExternalSyncState, SyncEntityType, SyncDirection, KaitenImportResult,
  DevelopmentParticipant, DevelopmentParticipantInput, KaitenStageOption, SyncOutboxJob, SyncOutboxStatus,
  ItemStatusRow, ItemStatusKind,
  RecurrenceRule, RecurringSeries,
} from "@/types";
import { generateInstanceDates, validateRecurrenceRule, MAX_INSTANCES } from "./recurrence";

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
  "recurring_series_id",
  // Planning V3 (0023 + 0024)
  "initiative_id", "linked_deal_id", "planned_period_id", "planned_date",
  "why", "replan_reason", "is_carryover",
  // P3 (0039)
  "assignee_participant_id",
  // P6 (0040)
  "planned_start_date", "planned_end_date",
] as const;

const TAG_UPDATE_FIELDS = ["name", "color", "position"] as const;
const DEV_STAGE_UPDATE_FIELDS = ["name", "position"] as const;
const ITEM_STATUS_UPDATE_FIELDS = ["name", "color", "position", "kind"] as const;
const DEV_PARTICIPANT_UPDATE_FIELDS = [
  "name", "position",
  "role", "is_active", "deactivated_at", "weekly_hours_default",
] as const;
const CATEGORY_UPDATE_FIELDS = ["name", "color", "icon", "position"] as const;
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
    const { item_id, ...p } = row;
    const list = participantMap.get(item_id);
    if (list) list.push(p); else participantMap.set(item_id, [p]);
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

export async function createItem(
  item: Omit<Item, "created_at" | "updated_at" | "recurring_series_id"> & { recurring_series_id?: string | null }
): Promise<Item> {
  const now = new Date().toISOString();
  const maxPos = await prepare<{ next_pos: number }>(
    "SELECT COALESCE(MAX(position), -1) + 1 as next_pos FROM items WHERE status = ? AND parent_id IS NOT DISTINCT FROM ?"
  ).get(item.status, item.parent_id ?? null);

  await prepare(`
    INSERT INTO items (id, title, description, type, status, priority, category, source, development_stage, due_date, due_time, estimated_minutes, position, parent_id, recurring_series_id, assignee_participant_id, planned_start_date, planned_end_date, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    item.id, item.title, item.description, item.type, item.status,
    item.priority, item.category, item.source ?? "system", item.development_stage ?? null,
    item.due_date ?? null, item.due_time ?? null, item.estimated_minutes ?? null,
    item.position ?? maxPos?.next_pos ?? 0, item.parent_id ?? null,
    item.recurring_series_id ?? null,
    item.assignee_participant_id ?? null,
    item.planned_start_date ?? null,
    item.planned_end_date ?? null,
    now, now
  );
  return (await getItemById(item.id))!;
}

export async function updateItem(
  id: string,
  updates: Partial<Item>,
  replanCtx?: { reason_code?: string | null; reason_text?: string | null; user_email?: string | null },
): Promise<Item | undefined> {
  const existing = await getItemById(id);
  if (!existing) return undefined;

  const built = buildUpdateClause(updates as Record<string, unknown>, ITEM_UPDATE_FIELDS);
  if (!built) return existing;

  const now = new Date().toISOString();

  // P7: если меняются планировочные поля и задача уже была запланирована —
  // прокидываем причину в триггер log_item_plan_change через SET LOCAL.
  // Должно быть в той же транзакции, что и UPDATE.
  const touchesPlan =
    "planned_start_date" in (updates as object) ||
    "planned_end_date" in (updates as object) ||
    "planned_date" in (updates as object) ||
    "planned_period_id" in (updates as object) ||
    "assignee_participant_id" in (updates as object);
  const wasPlanned = existing.planned_start_date || existing.planned_date;
  const needsReplanCtx = touchesPlan && wasPlanned && replanCtx;

  if (needsReplanCtx) {
    await transaction(async (tx) => {
      // set_config возвращает значение и принимает is_local; идемпотентный SET LOCAL.
      if (replanCtx.reason_code) {
        await tx.prepare("SELECT set_config('app.replan_reason_code', ?, true)").all(replanCtx.reason_code);
      }
      if (replanCtx.reason_text) {
        await tx.prepare("SELECT set_config('app.replan_reason_text', ?, true)").all(replanCtx.reason_text);
      }
      if (replanCtx.user_email) {
        await tx.prepare("SELECT set_config('app.user_email', ?, true)").all(replanCtx.user_email);
      }
      await tx.prepare(`UPDATE items SET ${built.sql}, updated_at = ? WHERE id = ?`)
        .run(...built.values, now, id);
    });
  } else {
    await prepare(`UPDATE items SET ${built.sql}, updated_at = ? WHERE id = ?`)
      .run(...built.values, now, id);
  }
  return await getItemById(id);
}

// ---------------- Plan history (P7) ----------------

export interface PlanningItemPlanHistoryRow {
  id: string;
  item_id: string;
  changed_at: string;
  changed_by: string | null;
  planned_start_before: string | null;
  planned_end_before: string | null;
  planned_period_id_before: string | null;
  assignee_before: string | null;
  planned_start_after: string | null;
  planned_end_after: string | null;
  planned_period_id_after: string | null;
  assignee_after: string | null;
  reason_code: string | null;
  reason_text: string | null;
}

export async function listItemPlanHistory(itemId: string): Promise<PlanningItemPlanHistoryRow[]> {
  return await prepare<PlanningItemPlanHistoryRow>(
    "SELECT * FROM planning_item_plan_history WHERE item_id = ? ORDER BY changed_at DESC"
  ).all(itemId);
}

export async function deleteItem(id: string): Promise<boolean> {
  const result = await prepare("DELETE FROM items WHERE id = ?").run(id);
  return result.changes > 0;
}

// ---------------- Recurring series ----------------

const SERIES_TEMPLATE_FIELDS = [
  "title", "description", "type", "status", "priority", "category",
  "due_time", "estimated_minutes",
] as const;

type SeriesRow = {
  id: string;
  title: string; description: string;
  type: string; status: string; priority: string; category: string;
  due_time: string | null; estimated_minutes: number | null;
  freq: string; interval: number;
  byweekday: number[] | null; bymonthday: number | null;
  start_date: string; until_date: string;
  created_at: string; updated_at: string;
};

function mapSeries(row: SeriesRow): RecurringSeries {
  return {
    id: row.id,
    title: row.title,
    description: row.description ?? "",
    type: row.type as RecurringSeries["type"],
    status: row.status as RecurringSeries["status"],
    priority: row.priority as RecurringSeries["priority"],
    category: row.category,
    due_time: row.due_time,
    estimated_minutes: row.estimated_minutes,
    freq: row.freq as RecurringSeries["freq"],
    interval: row.interval,
    byweekday: row.byweekday,
    bymonthday: row.bymonthday,
    start_date: typeof row.start_date === "string" ? row.start_date : new Date(row.start_date).toISOString().slice(0, 10),
    until_date: typeof row.until_date === "string" ? row.until_date : new Date(row.until_date).toISOString().slice(0, 10),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export async function getRecurringSeriesById(id: string): Promise<RecurringSeries | undefined> {
  const row = await prepare<SeriesRow>("SELECT * FROM recurring_series WHERE id = ?").get(id);
  return row ? mapSeries(row) : undefined;
}

/**
 * Create a recurring series anchored to an existing item. The source item
 * becomes the first generated instance; subsequent dates are materialised
 * as new items linked back via `recurring_series_id`.
 *
 * Rule's start_date is forced to equal the source item's due_date (or set
 * if the source had none). Throws if generated count > MAX_INSTANCES.
 */
export async function createRecurringSeriesFromItem(
  sourceItemId: string,
  rule: RecurrenceRule,
): Promise<{ series: RecurringSeries; created_count: number }> {
  validateRecurrenceRule(rule);

  const source = await getItemById(sourceItemId);
  if (!source) throw new Error("Source item not found");
  if (source.recurring_series_id) throw new Error("Item is already part of a series");
  if (source.parent_id) throw new Error("Subtasks cannot be made recurring");

  // Force start_date = source.due_date (or override source.due_date with start_date).
  const startDate = rule.start_date;
  const dates = generateInstanceDates(rule);
  if (dates.length === 0) throw new Error("Правило не порождает ни одного экземпляра");
  if (dates.length > MAX_INSTANCES) throw new Error(`Слишком много экземпляров (>${MAX_INSTANCES})`);
  if (dates[0] !== startDate) throw new Error("Первая дата экземпляра должна совпадать со start_date");

  const seriesId = crypto.randomUUID();
  const now = new Date().toISOString();

  await transaction(async (tx) => {
    await tx.prepare(`
      INSERT INTO recurring_series (
        id, title, description, type, status, priority, category,
        due_time, estimated_minutes,
        freq, interval, byweekday, bymonthday, start_date, until_date,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      seriesId,
      source.title, source.description ?? "", source.type, source.status, source.priority, source.category,
      source.due_time ?? null, source.estimated_minutes ?? null,
      rule.freq, rule.interval,
      rule.byweekday && rule.byweekday.length > 0 ? JSON.stringify(rule.byweekday) : null,
      rule.bymonthday ?? null,
      rule.start_date, rule.until_date,
      now, now,
    );

    // Link the source item as instance #0.
    await tx.prepare(
      "UPDATE items SET recurring_series_id = ?, due_date = ?, updated_at = ? WHERE id = ?"
    ).run(seriesId, startDate, now, sourceItemId);

    // Generate items for all subsequent dates.
    for (let i = 1; i < dates.length; i++) {
      const id = crypto.randomUUID();
      await tx.prepare(`
        INSERT INTO items (
          id, title, description, type, status, priority, category, source,
          development_stage, due_date, due_time, estimated_minutes,
          position, parent_id, recurring_series_id, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id, source.title, source.description ?? "", source.type, source.status, source.priority, source.category,
        source.source ?? "system", source.development_stage ?? null,
        dates[i], source.due_time ?? null, source.estimated_minutes ?? null,
        0, null, seriesId, now, now,
      );
    }
  });

  const series = await getRecurringSeriesById(seriesId);
  return { series: series!, created_count: dates.length };
}

/**
 * Update a recurring series: applies the new rule + template to all FUTURE
 * instances (due_date >= today). Past instances keep their original values.
 */
export async function updateRecurringSeriesFollowing(
  seriesId: string,
  rule: RecurrenceRule,
  template: Partial<RecurringSeries>,
): Promise<{ series: RecurringSeries; deleted_count: number; created_count: number }> {
  validateRecurrenceRule(rule);

  const existing = await getRecurringSeriesById(seriesId);
  if (!existing) throw new Error("Series not found");

  const today = new Date().toISOString().slice(0, 10);
  const fromDate = rule.start_date > today ? rule.start_date : today;

  // Newly-generated dates (only those >= fromDate are inserted).
  const allDates = generateInstanceDates(rule);
  const futureDates = allDates.filter((d) => d >= fromDate);
  if (futureDates.length > MAX_INSTANCES) {
    throw new Error(`Слишком много будущих экземпляров (>${MAX_INSTANCES})`);
  }

  const now = new Date().toISOString();
  let deletedCount = 0;
  let createdCount = 0;

  await transaction(async (tx) => {
    // Wipe future instances of the series.
    const del = await tx.prepare(
      "DELETE FROM items WHERE recurring_series_id = ? AND due_date >= ?"
    ).run(seriesId, today);
    deletedCount = del.changes ?? 0;

    // Update the series template + rule.
    const merged: Partial<RecurringSeries> = { ...existing, ...template };
    await tx.prepare(`
      UPDATE recurring_series SET
        title = ?, description = ?, type = ?, status = ?, priority = ?, category = ?,
        due_time = ?, estimated_minutes = ?,
        freq = ?, interval = ?, byweekday = ?, bymonthday = ?,
        start_date = ?, until_date = ?, updated_at = ?
      WHERE id = ?
    `).run(
      merged.title ?? existing.title,
      merged.description ?? existing.description,
      merged.type ?? existing.type,
      merged.status ?? existing.status,
      merged.priority ?? existing.priority,
      merged.category ?? existing.category,
      merged.due_time ?? existing.due_time ?? null,
      merged.estimated_minutes ?? existing.estimated_minutes ?? null,
      rule.freq, rule.interval,
      rule.byweekday && rule.byweekday.length > 0 ? JSON.stringify(rule.byweekday) : null,
      rule.bymonthday ?? null,
      rule.start_date, rule.until_date,
      now, seriesId,
    );

    // Insert fresh future instances.
    for (const date of futureDates) {
      const id = crypto.randomUUID();
      await tx.prepare(`
        INSERT INTO items (
          id, title, description, type, status, priority, category, source,
          development_stage, due_date, due_time, estimated_minutes,
          position, parent_id, recurring_series_id, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        merged.title ?? existing.title,
        merged.description ?? existing.description,
        merged.type ?? existing.type,
        merged.status ?? existing.status,
        merged.priority ?? existing.priority,
        merged.category ?? existing.category,
        "system",
        null,
        date,
        merged.due_time ?? existing.due_time ?? null,
        merged.estimated_minutes ?? existing.estimated_minutes ?? null,
        0, null, seriesId, now, now,
      );
      createdCount++;
    }
  });

  const series = (await getRecurringSeriesById(seriesId))!;
  return { series, deleted_count: deletedCount, created_count: createdCount };
}

/**
 * Delete future instances of a series (due_date >= today). If no instances
 * remain after deletion, drops the series row itself.
 */
export async function deleteRecurringSeriesFollowing(
  seriesId: string,
): Promise<{ deleted_count: number; series_removed: boolean }> {
  const existing = await getRecurringSeriesById(seriesId);
  if (!existing) return { deleted_count: 0, series_removed: false };

  const today = new Date().toISOString().slice(0, 10);
  let deleted = 0;
  let seriesRemoved = false;

  await transaction(async (tx) => {
    const del = await tx.prepare(
      "DELETE FROM items WHERE recurring_series_id = ? AND due_date >= ?"
    ).run(seriesId, today);
    deleted = del.changes ?? 0;

    const remaining = await tx.prepare<{ c: number }>(
      "SELECT COUNT(*) as c FROM items WHERE recurring_series_id = ?"
    ).get(seriesId);

    if ((remaining?.c ?? 0) === 0) {
      await tx.prepare("DELETE FROM recurring_series WHERE id = ?").run(seriesId);
      seriesRemoved = true;
    }
  });

  return { deleted_count: deleted, series_removed: seriesRemoved };
}

void SERIES_TEMPLATE_FIELDS;

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

export async function updateDevelopmentParticipant(
  id: string,
  updates: Partial<Pick<DevelopmentParticipant,
    "name" | "position" | "role" | "is_active" | "deactivated_at" | "weekly_hours_default"
  >>,
): Promise<DevelopmentParticipant | undefined> {
  // P2: автоматически проставляем deactivated_at при is_active=false.
  // owner-роль защищаем: нельзя менять роль/активность owner-участника (UI прячет,
  // но защита нужна на бэкенде на случай прямого запроса).
  const current = await prepare<DevelopmentParticipant>(
    "SELECT * FROM development_participants WHERE id = ?"
  ).get(id);
  if (!current) return undefined;

  const u: Record<string, unknown> = { ...updates };
  if (current.role === "owner") {
    delete u.role;
    delete u.is_active;
    delete u.deactivated_at;
  }
  if ("is_active" in u) {
    if (u.is_active === false && current.is_active !== false) {
      u.deactivated_at = new Date().toISOString();
    } else if (u.is_active === true && current.is_active === false) {
      u.deactivated_at = null;
    }
  }
  if ("role" in u && u.role === "owner" && current.role !== "owner") {
    // Нельзя присвоить роль owner — только сидируется миграцией.
    delete u.role;
  }

  const built = buildUpdateClause(u, DEV_PARTICIPANT_UPDATE_FIELDS);
  if (!built) return current;
  const now = new Date().toISOString();
  await prepare(`UPDATE development_participants SET ${built.sql}, updated_at = ? WHERE id = ?`)
    .run(...built.values, now, id);
  return await prepare<DevelopmentParticipant>("SELECT * FROM development_participants WHERE id = ?").get(id);
}

export async function deleteDevelopmentParticipant(id: string): Promise<boolean | "owner_protected"> {
  // owner — защищён от удаления.
  const cur = await prepare<DevelopmentParticipant>(
    "SELECT * FROM development_participants WHERE id = ?"
  ).get(id);
  if (!cur) return false;
  if (cur.role === "owner") return "owner_protected";
  await prepare("DELETE FROM item_development_participants WHERE participant_id = ?").run(id);
  const result = await prepare("DELETE FROM development_participants WHERE id = ?").run(id);
  return result.changes > 0;
}

export async function createDevelopmentParticipant(
  name: string,
  opts?: { role?: "developer" | "other"; weekly_hours_default?: number },
): Promise<DevelopmentParticipant> {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const maxPos = await prepare<{ p: number }>("SELECT COALESCE(MAX(position), -1) + 1 as p FROM development_participants").get();
  await prepare(`
    INSERT INTO development_participants
      (id, provider, remote_id, name, position, role, weekly_hours_default, created_at, updated_at)
    VALUES (?, NULL, NULL, ?, ?, ?, ?, ?, ?)
  `).run(
    id, name, maxPos?.p ?? 0,
    opts?.role ?? "developer",
    opts?.weekly_hours_default ?? 40,
    now, now,
  );
  return (await prepare<DevelopmentParticipant>("SELECT * FROM development_participants WHERE id = ?").get(id))!;
}

// ---------------- Participant Capacity (per-week) ----------------

export async function listParticipantCapacities(periodId: string): Promise<PlanningParticipantCapacity[]> {
  return await prepare<PlanningParticipantCapacity>(
    "SELECT * FROM planning_participant_capacity WHERE period_id = ?"
  ).all(periodId);
}

export async function upsertParticipantCapacity(
  input: UpsertParticipantCapacityInput,
): Promise<PlanningParticipantCapacity> {
  await prepare(`
    INSERT INTO planning_participant_capacity
      (participant_id, period_id, hours_override, is_active_override, note)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (participant_id, period_id) DO UPDATE SET
      hours_override = EXCLUDED.hours_override,
      is_active_override = EXCLUDED.is_active_override,
      note = EXCLUDED.note,
      updated_at = now()
  `).run(
    input.participant_id, input.period_id,
    input.hours_override ?? null,
    input.is_active_override ?? null,
    input.note ?? null,
  );
  return (await prepare<PlanningParticipantCapacity>(
    "SELECT * FROM planning_participant_capacity WHERE participant_id = ? AND period_id = ?"
  ).get(input.participant_id, input.period_id))!;
}

export async function deleteParticipantCapacity(id: string): Promise<boolean> {
  const r = await prepare("DELETE FROM planning_participant_capacity WHERE id = ?").run(id);
  return r.changes > 0;
}

export async function getEffectiveCapacity(
  participantId: string, periodId: string,
): Promise<EffectiveCapacity> {
  const p = await prepare<DevelopmentParticipant>(
    "SELECT * FROM development_participants WHERE id = ?"
  ).get(participantId);
  if (!p) throw new Error(`Participant ${participantId} not found`);
  const ov = await prepare<PlanningParticipantCapacity>(
    "SELECT * FROM planning_participant_capacity WHERE participant_id = ? AND period_id = ?"
  ).get(participantId, periodId);
  const activeFromOv = ov?.is_active_override;
  const isActive = (activeFromOv === null || activeFromOv === undefined) ? p.is_active : activeFromOv;
  const hoursFromOv = ov?.hours_override;
  const hoursRaw = (hoursFromOv === null || hoursFromOv === undefined)
    ? Number(p.weekly_hours_default)
    : Number(hoursFromOv);
  return {
    participant_id: participantId,
    hours: isActive ? hoursRaw : 0,
    is_active: isActive,
    source: {
      hours: (hoursFromOv === null || hoursFromOv === undefined) ? "default" : "override",
      active: (activeFromOv === null || activeFromOv === undefined) ? "default" : "override",
    },
  };
}

export async function listEffectiveCapacities(periodId: string): Promise<EffectiveCapacity[]> {
  const participants = await prepare<DevelopmentParticipant>(
    "SELECT * FROM development_participants"
  ).all();
  const overrides = await listParticipantCapacities(periodId);
  const ovById = new Map(overrides.map((o) => [o.participant_id, o]));
  return participants.map((p) => {
    const ov = ovById.get(p.id);
    const activeFromOv = ov?.is_active_override;
    const isActive = (activeFromOv === null || activeFromOv === undefined) ? p.is_active : activeFromOv;
    const hoursFromOv = ov?.hours_override;
    const hoursRaw = (hoursFromOv === null || hoursFromOv === undefined)
      ? Number(p.weekly_hours_default)
      : Number(hoursFromOv);
    return {
      participant_id: p.id,
      hours: isActive ? hoursRaw : 0,
      is_active: isActive,
      source: {
        hours: (hoursFromOv === null || hoursFromOv === undefined) ? "default" as const : "override" as const,
        active: (activeFromOv === null || activeFromOv === undefined) ? "default" as const : "override" as const,
      },
    };
  });
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

// ---------------- Weekly Plans (REMOVED) ----------------
// Replaced by planning_periods (type='week') + items.planned_period_id in migration 0024.
// All weekly_plan_* / entry_comments functions removed; new domain functions live in
// the planning_* section added in Phase 1.6.

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

  function resolveTitle(type: string, id: string): string {
    if (type === "item") return allItemTitles.get(id) ?? "";
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

// ============================================================================
// Planning system V3 (migrations 0023 + 0024)
// ============================================================================
//
// Conventions:
//   * UUID PK columns return as strings from postgres.js — typed as `string`.
//   * JSONB columns are auto-parsed by postgres.js on read; on write we pass a
//     JS object — postgres.js serialises automatically when the placeholder
//     binds to a jsonb param. (We never pass `JSON.stringify(...)` here.)
//   * `actor_email` is the single-tenant author — no `auth.uid()`.
//   * All builder helpers reuse `buildUpdateClause()` and the per-entity
//     allowlists below for SQL-injection-safe updates.

import type {
  PlanningDirection,
  PlanningPeriod,
  PlanningMetric,
  PlanningMetricTarget,
  PlanningMetricTick,
  PlanningInitiative,
  PlanningInitiativeDependency,
  PlanningInitiativeMetricLink,
  PlanningInitiativeClientBlock,
  PlanningInitiativeClientLink,
  ClientDeal,
  ClientDealPayment,
  ClientDealLifecycleStage,
  PlanningChangeLogEntry,
  PlanningSettings,
  PlanningIcpSegment,
  PlanningReplanReasonDict,
  PlanningMetricUnit,
  PlanningKaitenBoardMapping,
  PlanningParticipantCapacity,
  UpsertParticipantCapacityInput,
  EffectiveCapacity,
  PeriodType,
  CreateDirectionInput,
  UpdateDirectionInput,
  UpsertPeriodInput,
  CreateMetricInput,
  UpdateMetricInput,
  UpsertMetricTargetInput,
  CreateMetricTickInput,
  CreateInitiativeInput,
  UpdateInitiativeInput,
  CreateClientDealInput,
  UpdateClientDealInput,
  CreateClientDealPaymentInput,
  UpdateClientDealPaymentInput,
  ChangeLogInsertInput,
  UpdatePlanningSettingsInput,
  PlanningPeriodRetrospective,
  InitiativeStatus,
  DealBlockingStage,
} from "@/types/planning";

const PLANNING_DIRECTION_UPDATE_FIELDS = ["title", "year_focus", "position"] as const;
const PLANNING_PERIOD_UPDATE_FIELDS = [
  "direction_id", "type", "year", "quarter_n", "month_n", "week_n",
  "start_date", "end_date", "capacity_hours", "metric_targets_snapshot",
] as const;
const PLANNING_METRIC_UPDATE_FIELDS = [
  "title", "type", "unit", "direction_value", "baseline", "annual_target",
  "source", "source_id", "is_cumulative", "is_emergent", "position",
] as const;
const PLANNING_INITIATIVE_UPDATE_FIELDS = [
  "title", "type", "description", "jtbd", "due_period_id",
  "start_period_id", "end_period_id", "estimate_hours",
  "rice_reach", "rice_impact", "rice_confidence", "key_assumptions", "kill_criteria",
  "parent_initiative_id", "hypothesis", "success_criteria", "sample_size_or_duration",
  "experiment_result", "experiment_decision", "status", "done_at", "position",
] as const;
// P8: client_deals заменили planning_deals.
const CLIENT_DEAL_UPDATE_FIELDS = [
  "title", "status_id", "status_changed_at",
  "pilot_started_at", "pilot_default_duration_days", "pilot_planned_end_at",
  "pilot_ended_at", "production_started_at", "min_monthly_amount",
  "expected_actual_amount", "description", "position",
] as const;
const CLIENT_DEAL_PAYMENT_UPDATE_FIELDS = ["paid_at", "amount", "note", "status"] as const;
const PLANNING_SETTINGS_UPDATE_FIELDS = [
  "pilot_default_duration_days", "early_warning_weeks", "strategy_support_ratio",
  "minor_adjustment_threshold", "daily_capacity_hours", "weekly_capacity_hours",
  "accent_color", "weekend_days_visible",
  // P8: мэппинг lifecycle stage на статусы клиента.
  "pilot_status_id", "production_status_id", "churned_status_ids",
] as const;

// ---------------- Directions ----------------

export async function listDirections(): Promise<PlanningDirection[]> {
  return await prepare<PlanningDirection>(
    "SELECT * FROM planning_directions ORDER BY position ASC, created_at ASC"
  ).all();
}

export async function getDirection(id: string): Promise<PlanningDirection | undefined> {
  return await prepare<PlanningDirection>(
    "SELECT * FROM planning_directions WHERE id = ?"
  ).get(id);
}

export async function createDirection(input: CreateDirectionInput): Promise<PlanningDirection> {
  const row = await prepare<PlanningDirection>(`
    INSERT INTO planning_directions (title, year_focus, position)
    VALUES (?, ?, ?)
    RETURNING *
  `).get(input.title, input.year_focus ?? null, input.position ?? 0);
  return row!;
}

export async function updateDirection(id: string, updates: UpdateDirectionInput): Promise<PlanningDirection | undefined> {
  const built = buildUpdateClause(updates as Record<string, unknown>, PLANNING_DIRECTION_UPDATE_FIELDS);
  if (!built) return await getDirection(id);
  const now = new Date().toISOString();
  await prepare(`UPDATE planning_directions SET ${built.sql}, updated_at = ? WHERE id = ?`)
    .run(...built.values, now, id);
  return await getDirection(id);
}

export async function deleteDirection(id: string): Promise<boolean> {
  const r = await prepare("DELETE FROM planning_directions WHERE id = ?").run(id);
  return r.changes > 0;
}

// ---------------- Periods ----------------

export async function listPeriods(filter?: {
  directionId?: string | null;
  type?: PeriodType;
  year?: number;
}): Promise<PlanningPeriod[]> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (filter?.directionId !== undefined) {
    if (filter.directionId === null) conditions.push("direction_id IS NULL");
    else { conditions.push("direction_id = ?"); params.push(filter.directionId); }
  }
  if (filter?.type) { conditions.push("type = ?"); params.push(filter.type); }
  if (filter?.year != null) { conditions.push("year = ?"); params.push(filter.year); }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  return await prepare<PlanningPeriod>(
    `SELECT * FROM planning_periods ${where} ORDER BY start_date ASC`
  ).all(...params);
}

export async function getPeriod(id: string): Promise<PlanningPeriod | undefined> {
  return await prepare<PlanningPeriod>("SELECT * FROM planning_periods WHERE id = ?").get(id);
}

export async function upsertPeriod(input: UpsertPeriodInput): Promise<PlanningPeriod> {
  // Slot uniqueness is enforced by uq_planning_periods_slot on
  // (direction_id, type, year, COALESCE(quarter_n,0), COALESCE(month_n,0), COALESCE(week_n,0)).
  const row = await prepare<PlanningPeriod>(`
    INSERT INTO planning_periods (
      direction_id, type, year, quarter_n, month_n, week_n,
      start_date, end_date, capacity_hours
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (direction_id, type, year,
      COALESCE(quarter_n, 0), COALESCE(month_n, 0), COALESCE(week_n, 0))
    DO UPDATE SET
      start_date = EXCLUDED.start_date,
      end_date = EXCLUDED.end_date,
      capacity_hours = COALESCE(EXCLUDED.capacity_hours, planning_periods.capacity_hours),
      updated_at = now()
    RETURNING *
  `).get(
    input.direction_id ?? null,
    input.type, input.year,
    input.quarter_n ?? null, input.month_n ?? null, input.week_n ?? null,
    input.start_date, input.end_date,
    input.capacity_hours ?? null,
  );
  return row!;
}

export async function updateRetrospective(
  id: string,
  retrospective: PlanningPeriodRetrospective,
): Promise<PlanningPeriod | undefined> {
  await prepare(
    "UPDATE planning_periods SET retrospective = ?, updated_at = now() WHERE id = ?"
  ).run(retrospective, id);
  return await getPeriod(id);
}

// ---------------- Metrics ----------------

export async function listMetrics(directionId?: string | null): Promise<PlanningMetric[]> {
  if (directionId === undefined) {
    return await prepare<PlanningMetric>(
      "SELECT * FROM planning_metrics ORDER BY position ASC, created_at ASC"
    ).all();
  }
  if (directionId === null) {
    return await prepare<PlanningMetric>(
      "SELECT * FROM planning_metrics WHERE direction_id IS NULL ORDER BY position ASC, created_at ASC"
    ).all();
  }
  return await prepare<PlanningMetric>(
    "SELECT * FROM planning_metrics WHERE direction_id = ? ORDER BY position ASC, created_at ASC"
  ).all(directionId);
}

export async function getMetric(id: string): Promise<PlanningMetric | undefined> {
  return await prepare<PlanningMetric>("SELECT * FROM planning_metrics WHERE id = ?").get(id);
}

export async function createMetric(input: CreateMetricInput): Promise<PlanningMetric> {
  const row = await prepare<PlanningMetric>(`
    INSERT INTO planning_metrics (
      direction_id, title, type, unit, direction_value, baseline, annual_target,
      source, source_id, is_cumulative, is_emergent, position
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    RETURNING *
  `).get(
    input.direction_id ?? null,
    input.title, input.type,
    input.unit ?? null, input.direction_value ?? null, input.baseline ?? null,
    input.annual_target ?? null,
    input.source ?? null, input.source_id ?? null,
    input.is_cumulative ?? true, input.is_emergent ?? false,
    input.position ?? 0,
  );
  return row!;
}

export async function updateMetric(id: string, updates: UpdateMetricInput): Promise<PlanningMetric | undefined> {
  const built = buildUpdateClause(updates as Record<string, unknown>, PLANNING_METRIC_UPDATE_FIELDS);
  if (!built) return await getMetric(id);
  await prepare(`UPDATE planning_metrics SET ${built.sql}, updated_at = now() WHERE id = ?`)
    .run(...built.values, id);
  return await getMetric(id);
}

export async function deleteMetric(id: string): Promise<boolean> {
  const r = await prepare("DELETE FROM planning_metrics WHERE id = ?").run(id);
  return r.changes > 0;
}

// ---------------- Metric targets ----------------

export async function listMetricTargets(metricId: string): Promise<PlanningMetricTarget[]> {
  return await prepare<PlanningMetricTarget>(
    "SELECT * FROM planning_metric_targets WHERE metric_id = ? ORDER BY created_at ASC"
  ).all(metricId);
}

/**
 * Aggregated targets view: для квартала/месяца/года синтезируем строки из
 * суммы недель, перекрывающих диапазон периода. Для type='week' возвращаем
 * реальные строки. Используется P4 — таргеты хранятся только на неделях.
 *
 * Возвращаемые «строки» для агрегированных периодов имеют формат
 * PlanningMetricTarget, но `id` синтетический (`agg:<period_id>`), а
 * `target_value` — сумма week-таргетов внутри [start_date, end_date]
 * соответствующего period.
 */
export async function listMetricTargetsForPeriodType(
  metricId: string,
  periodType: "year" | "quarter" | "month" | "week",
  year: number,
  directionId: string | null,
): Promise<PlanningMetricTarget[]> {
  if (periodType === "week") {
    // Реальные week-row из БД, отфильтрованные по году+направлению через JOIN.
    return await prepare<PlanningMetricTarget>(`
      SELECT t.*
      FROM planning_metric_targets t
      JOIN planning_periods p ON p.id = t.period_id
      WHERE t.metric_id = ?
        AND p.type = 'week'
        AND p.year = ?
        AND p.direction_id IS NOT DISTINCT FROM ?
      ORDER BY p.start_date ASC
    `).all(metricId, year, directionId);
  }

  // Aggregated: для каждого периода нужной агрегации находим week-targets
  // которые попадают в его диапазон (по start_date недели).
  type AggRow = {
    period_id: string;
    metric_id: string;
    target_value: string;
    created_at: string;
    updated_at: string;
  };
  // ISO-week → quarter/month: неделя относится к кварталу/месяцу, в котором
  // лежит её четверг (start_date + 3). Это сохраняет инвариант
  // SUM(quarters)=SUM(months)=SUM(weeks)=annual_target, в т.ч. для лет с 53
  // неделями (неделя 1 может начинаться в декабре прошлого года, неделя 53 —
  // заканчиваться в январе следующего; «целиком внутри квартала» теряет их).
  const rows = await prepare<AggRow>(`
    SELECT
      agg.id AS period_id,
      ?::uuid AS metric_id,
      COALESCE(SUM(wt.target_value), 0)::numeric AS target_value,
      MIN(wt.created_at) AS created_at,
      MAX(wt.updated_at) AS updated_at
    FROM planning_periods agg
    LEFT JOIN planning_periods wk
      ON wk.type = 'week'
      AND wk.direction_id IS NOT DISTINCT FROM agg.direction_id
      AND (wk.start_date + 3) >= agg.start_date
      AND (wk.start_date + 3) <= agg.end_date
    LEFT JOIN planning_metric_targets wt
      ON wt.period_id = wk.id
      AND wt.metric_id = ?
    WHERE agg.type = ?
      AND agg.year = ?
      AND agg.direction_id IS NOT DISTINCT FROM ?
    GROUP BY agg.id, agg.start_date
    ORDER BY agg.start_date ASC
  `).all(metricId, metricId, periodType, year, directionId);

  return rows.map((r) => ({
    id: `agg:${r.period_id}`,
    metric_id: r.metric_id,
    period_id: r.period_id,
    target_value: Number(r.target_value),
    created_at: r.created_at ?? new Date().toISOString(),
    updated_at: r.updated_at ?? new Date().toISOString(),
  }));
}

/**
 * Для patch'а агрегированного period (quarter/month): пропорционально разносит
 * `newTotal` на week-children, сохраняя их относительные доли. Если у периода
 * ещё нет week-таргетов — раскладывает равномерно.
 */
export async function patchAggregatedTarget(
  metricId: string,
  aggregatePeriodId: string,
  newTotal: number,
): Promise<PlanningMetricTarget[]> {
  // 1) Найти week-periods, относящиеся к этому aggregate по Thursday-правилу
  //    (см. listMetricTargetsForPeriodType — тот же инвариант сохранения суммы).
  const weeks = await prepare<{ id: string }>(`
    SELECT wk.id
    FROM planning_periods agg
    JOIN planning_periods wk
      ON wk.type = 'week'
      AND wk.direction_id IS NOT DISTINCT FROM agg.direction_id
      AND (wk.start_date + 3) >= agg.start_date
      AND (wk.start_date + 3) <= agg.end_date
    WHERE agg.id = ?
    ORDER BY wk.start_date ASC
  `).all(aggregatePeriodId);
  if (weeks.length === 0) return [];

  // 2) Текущие week-targets
  const current = await prepare<{ period_id: string; target_value: string }>(`
    SELECT period_id, target_value
    FROM planning_metric_targets
    WHERE metric_id = ?
      AND period_id = ANY(?::uuid[])
  `).all(metricId, weeks.map((w) => w.id));
  const byPeriod = new Map(current.map((c) => [c.period_id, Number(c.target_value)]));
  const currentSum = weeks.reduce((s, w) => s + (byPeriod.get(w.id) ?? 0), 0);

  // 3) Пропорциональное переразмещение. Если currentSum=0 — равномерно.
  const items: UpsertMetricTargetInput[] = weeks.map((w) => {
    const old = byPeriod.get(w.id) ?? 0;
    const share = currentSum > 0 ? old / currentSum : 1 / weeks.length;
    return { metric_id: metricId, period_id: w.id, target_value: newTotal * share };
  });
  return await bulkUpsertMetricTargets(items);
}

export async function bulkUpsertMetricTargets(
  items: UpsertMetricTargetInput[],
): Promise<PlanningMetricTarget[]> {
  if (items.length === 0) return [];
  const out: PlanningMetricTarget[] = [];
  await transaction(async (tx) => {
    for (const it of items) {
      const row = await tx.prepare<PlanningMetricTarget>(`
        INSERT INTO planning_metric_targets (metric_id, period_id, target_value)
        VALUES (?, ?, ?)
        ON CONFLICT (metric_id, period_id) DO UPDATE
          SET target_value = EXCLUDED.target_value, updated_at = now()
        RETURNING *
      `).get(it.metric_id, it.period_id, it.target_value);
      if (row) out.push(row);
    }
  });
  return out;
}

// ---------------- Metric ticks ----------------

export async function listMetricTicks(
  metricId: string,
  range?: { from?: string; to?: string; limit?: number },
): Promise<PlanningMetricTick[]> {
  const conditions: string[] = ["metric_id = ?"];
  const params: unknown[] = [metricId];
  if (range?.from) { conditions.push("measured_at >= ?"); params.push(range.from); }
  if (range?.to) { conditions.push("measured_at <= ?"); params.push(range.to); }
  const limit = range?.limit ? ` LIMIT ${Number(range.limit) | 0}` : "";
  return await prepare<PlanningMetricTick>(
    `SELECT * FROM planning_metric_ticks WHERE ${conditions.join(" AND ")}
     ORDER BY measured_at DESC${limit}`
  ).all(...params);
}

/**
 * P5+P8: effective ticks for a metric. Если metric.source='second_brain' и
 * metric.type='business' — синтезируем ticks из client_deal_payments.
 * Иначе — обычные planning_metric_ticks.
 *
 * Concept §6.7.2 + P8: «expected-платежи автоматически считаются как факт».
 * P8: виртуальная выручка от пилота включается в метрику Выручка (пользователь
 * подтвердил §8 ответом «Да, с начала пилота, в метрику выручка включаем»).
 */
export async function listEffectiveMetricTicks(
  metric: PlanningMetric,
  range?: { from?: string; to?: string; limit?: number },
): Promise<PlanningMetricTick[]> {
  if (metric.source !== "second_brain" || metric.type !== "business") {
    return listMetricTicks(metric.id, range);
  }

  const conds: string[] = [];
  const params: unknown[] = [];
  if (range?.from) { conds.push("p.paid_at >= ?"); params.push(range.from); }
  if (range?.to)   { conds.push("p.paid_at <= ?"); params.push(range.to); }
  const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
  const limit = range?.limit ? ` LIMIT ${Number(range.limit) | 0}` : "";
  type Row = { id: string; amount: string; paid_at: string; status: string };
  const rows = await prepare<Row>(
    `SELECT p.id, p.amount::text, p.paid_at, p.status
     FROM client_deal_payments p
     JOIN client_deals d ON d.id = p.deal_id
     ${where}
     ORDER BY p.paid_at DESC${limit}`
  ).all(...params);
  return rows.map((r) => ({
    id: `cdp:${r.id}`,
    metric_id: metric.id,
    value: Number(r.amount),
    measured_at: r.paid_at,
    source: `client_deal_payment:${r.status}`,
    created_at: r.paid_at,
  }));
}

export async function addMetricTick(input: CreateMetricTickInput): Promise<PlanningMetricTick> {
  const row = await prepare<PlanningMetricTick>(`
    INSERT INTO planning_metric_ticks (metric_id, value, measured_at, source)
    VALUES (?, ?, ?, ?)
    RETURNING *
  `).get(input.metric_id, input.value, input.measured_at, input.source ?? null);
  return row!;
}

// F6: ручное удаление tick'а (для cumulative-метрик нет другого способа
// убрать ошибочный факт — non-cumulative переписывается «last wins»).
export async function deleteMetricTick(metricId: string, tickId: string): Promise<boolean> {
  const row = await prepare<{ id: string }>(
    "DELETE FROM planning_metric_ticks WHERE id = ? AND metric_id = ? RETURNING id",
  ).get(tickId, metricId);
  return !!row;
}

// ---------------- Initiatives ----------------

export async function listInitiatives(filter?: {
  directionId?: string | null;
  status?: InitiativeStatus;
  dueAfter?: string;
  dueBefore?: string;
  type?: PlanningInitiative["type"];
  includeArchivedAfterDays?: number;
}): Promise<PlanningInitiative[]> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (filter?.directionId !== undefined) {
    if (filter.directionId === null) conditions.push("i.direction_id IS NULL");
    else { conditions.push("i.direction_id = ?"); params.push(filter.directionId); }
  }
  if (filter?.status) { conditions.push("i.status = ?"); params.push(filter.status); }
  if (filter?.type) { conditions.push("i.type = ?"); params.push(filter.type); }
  if (filter?.dueAfter) { conditions.push("(p.end_date IS NULL OR p.end_date >= ?)"); params.push(filter.dueAfter); }
  if (filter?.dueBefore) { conditions.push("(p.end_date IS NULL OR p.end_date <= ?)"); params.push(filter.dueBefore); }
  // Auto-archive: hide done > N days unless caller opts in
  if (filter?.includeArchivedAfterDays !== undefined) {
    const days = Math.max(0, filter.includeArchivedAfterDays | 0);
    conditions.push(`(i.status != 'done' OR i.done_at IS NULL OR i.done_at >= now() - INTERVAL '${days} days')`);
  }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  // P7.4: денормализуем tasks_total / tasks_done через planning_item_initiative_link
  // (M:N из P3). Подзадачи родителей-привязанных тоже считаются — `linkItemToInitiative`
  // в db.ts включает их автоматически.
  const rows = await prepare<PlanningInitiative & { tasks_total: string | number; tasks_done: string | number }>(
    `SELECT i.*,
            COALESCE(t.total, 0) AS tasks_total,
            COALESCE(t.done_count, 0) AS tasks_done
     FROM planning_initiatives i
     LEFT JOIN planning_periods p ON p.id = i.due_period_id
     LEFT JOIN (
       SELECT l.initiative_id,
              COUNT(*) AS total,
              SUM(CASE WHEN it.status = 'done' THEN 1 ELSE 0 END) AS done_count
       FROM planning_item_initiative_link l
       JOIN items it ON it.id = l.item_id
       GROUP BY l.initiative_id
     ) t ON t.initiative_id = i.id
     ${where}
     ORDER BY i.position ASC, i.created_at ASC`
  ).all(...params);
  return rows.map((r) => ({
    ...r,
    tasks_total: Number(r.tasks_total),
    tasks_done: Number(r.tasks_done),
  }));
}

export async function getInitiative(id: string): Promise<PlanningInitiative | undefined> {
  return await prepare<PlanningInitiative>(
    "SELECT * FROM planning_initiatives WHERE id = ?"
  ).get(id);
}

export async function createInitiative(input: CreateInitiativeInput): Promise<PlanningInitiative> {
  // end_period_id — основной источник правды дедлайна; due_period_id зеркалит его
  // через trigger sync_due_period (migration 0028) при UPDATE, при INSERT —
  // подставляем явно, чтобы карточка показывала дедлайн сразу после создания.
  const endId = input.end_period_id ?? input.due_period_id ?? null;
  const startId = input.start_period_id ?? endId;
  const row = await prepare<PlanningInitiative>(`
    INSERT INTO planning_initiatives (
      direction_id, title, type, description, jtbd,
      due_period_id, start_period_id, end_period_id, estimate_hours,
      rice_reach, rice_impact, rice_confidence, key_assumptions, kill_criteria,
      parent_initiative_id, created_from_task_id,
      hypothesis, success_criteria, sample_size_or_duration
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    RETURNING *
  `).get(
    input.direction_id ?? null,
    input.title, input.type,
    input.description ?? null, input.jtbd ?? null,
    endId, startId, endId, input.estimate_hours ?? null,
    input.rice_reach ?? null, input.rice_impact ?? null, input.rice_confidence ?? null,
    input.key_assumptions ?? null, input.kill_criteria ?? null,
    input.parent_initiative_id ?? null, input.created_from_task_id ?? null,
    input.hypothesis ?? null, input.success_criteria ?? null,
    input.sample_size_or_duration ?? null,
  );
  return row!;
}

export async function updateInitiative(id: string, updates: UpdateInitiativeInput): Promise<PlanningInitiative | undefined> {
  const built = buildUpdateClause(updates as Record<string, unknown>, PLANNING_INITIATIVE_UPDATE_FIELDS);
  if (!built) return await getInitiative(id);
  await prepare(`UPDATE planning_initiatives SET ${built.sql}, updated_at = now() WHERE id = ?`)
    .run(...built.values, id);
  return await getInitiative(id);
}

export async function deleteInitiative(id: string): Promise<boolean> {
  const r = await prepare("DELETE FROM planning_initiatives WHERE id = ?").run(id);
  return r.changes > 0;
}

// Initiative ↔ Metric / Deal / Client / Dependency links
export async function linkInitiativeToMetric(initiativeId: string, metricId: string): Promise<void> {
  await prepare(
    "INSERT INTO planning_initiative_metric_link (initiative_id, metric_id) VALUES (?, ?) ON CONFLICT DO NOTHING"
  ).run(initiativeId, metricId);
}
export async function unlinkInitiativeFromMetric(initiativeId: string, metricId: string): Promise<void> {
  await prepare(
    "DELETE FROM planning_initiative_metric_link WHERE initiative_id = ? AND metric_id = ?"
  ).run(initiativeId, metricId);
}
export async function listInitiativeMetricLinks(initiativeId: string): Promise<PlanningInitiativeMetricLink[]> {
  return await prepare<PlanningInitiativeMetricLink>(
    "SELECT * FROM planning_initiative_metric_link WHERE initiative_id = ?"
  ).all(initiativeId);
}
export async function listMetricInitiativeLinks(metricId: string): Promise<PlanningInitiativeMetricLink[]> {
  return await prepare<PlanningInitiativeMetricLink>(
    "SELECT * FROM planning_initiative_metric_link WHERE metric_id = ?"
  ).all(metricId);
}

// P8: «инициатива блокирует клиента (опц. конкретную его сделку)»
// заменяет linkInitiativeToDeal. UNIQUE INDEX uniq_initiative_client_block
// с NULLS NOT DISTINCT (см. migration 0035) — поэтому ON CONFLICT работает
// корректно когда deal_id=null.
export async function linkInitiativeToClientBlock(
  initiativeId: string,
  clientId: string,
  dealId: string | null,
  blocksStage?: DealBlockingStage | null,
): Promise<void> {
  await prepare(`
    INSERT INTO planning_initiative_client_block (initiative_id, client_id, deal_id, blocks_stage)
    VALUES (?, ?, ?, ?)
    ON CONFLICT (initiative_id, client_id, deal_id)
      DO UPDATE SET blocks_stage = EXCLUDED.blocks_stage
  `).run(initiativeId, clientId, dealId, blocksStage ?? null);
}

export async function unlinkInitiativeFromClientBlock(
  initiativeId: string,
  clientId: string,
  dealId: string | null,
): Promise<void> {
  // NULL не сравнивается через '=', поэтому используем IS NOT DISTINCT FROM.
  await prepare(`
    DELETE FROM planning_initiative_client_block
    WHERE initiative_id = ?
      AND client_id = ?
      AND deal_id IS NOT DISTINCT FROM ?
  `).run(initiativeId, clientId, dealId);
}

export async function listInitiativeClientBlocks(initiativeId: string): Promise<PlanningInitiativeClientBlock[]> {
  return await prepare<PlanningInitiativeClientBlock>(
    "SELECT * FROM planning_initiative_client_block WHERE initiative_id = ?"
  ).all(initiativeId);
}

export async function linkInitiativeToClient(initiativeId: string, clientId: string): Promise<void> {
  await prepare(
    "INSERT INTO planning_initiative_client_link (initiative_id, client_id) VALUES (?, ?) ON CONFLICT DO NOTHING"
  ).run(initiativeId, clientId);
}
export async function unlinkInitiativeFromClient(initiativeId: string, clientId: string): Promise<void> {
  await prepare(
    "DELETE FROM planning_initiative_client_link WHERE initiative_id = ? AND client_id = ?"
  ).run(initiativeId, clientId);
}
export async function listInitiativeClientLinks(initiativeId: string): Promise<PlanningInitiativeClientLink[]> {
  return await prepare<PlanningInitiativeClientLink>(
    "SELECT * FROM planning_initiative_client_link WHERE initiative_id = ?"
  ).all(initiativeId);
}

// P6: «Зависимости инициатив» удалены из системы (PLAN_PLANNING_REWORK §0).
// Helpers оставлены как no-op для обратной совместимости с существующими
// импортами; таблица planning_initiative_dependency dropped миграцией 0032.
export async function addDependency(_initiativeId: string, _dependsOnId: string): Promise<void> {
  return;
}
export async function removeDependency(_initiativeId: string, _dependsOnId: string): Promise<void> {
  return;
}
export async function listInitiativeDependencies(_initiativeId: string): Promise<PlanningInitiativeDependency[]> {
  return [];
}

// ---------------- Initiative ↔ Item (M:N, P3) ----------------
// Источник правды для «задач инициативы» — planning_item_initiative_link.
// Триггер 0030 синхронизирует legacy-колонку items.initiative_id ⇒ M:N.

export async function linkItemToInitiative(itemId: string, initiativeId: string): Promise<void> {
  await prepare(
    "INSERT INTO planning_item_initiative_link (item_id, initiative_id) VALUES (?, ?) ON CONFLICT DO NOTHING"
  ).run(itemId, initiativeId);
}

export async function unlinkItemFromInitiative(itemId: string, initiativeId: string): Promise<void> {
  // Если legacy items.initiative_id указывает на эту инициативу — сбрасываем,
  // иначе триггер re-insert вернёт связь обратно при следующем UPDATE.
  await prepare(
    "UPDATE items SET initiative_id = NULL WHERE id = ? AND initiative_id = ?"
  ).run(itemId, initiativeId);
  await prepare(
    "DELETE FROM planning_item_initiative_link WHERE item_id = ? AND initiative_id = ?"
  ).run(itemId, initiativeId);
}

export async function listItemInitiativeLinks(itemId: string): Promise<{ item_id: string; initiative_id: string }[]> {
  return await prepare<{ item_id: string; initiative_id: string }>(
    "SELECT item_id, initiative_id FROM planning_item_initiative_link WHERE item_id = ?"
  ).all(itemId);
}

/**
 * Items привязанные к инициативе (через M:N) + их подзадачи.
 * Concept §P3: «Подзадачи (items.parent_id != null) показываются автоматически
 * если parent в инициативе».
 */
export async function listInitiativeItems(initiativeId: string): Promise<Item[]> {
  const linked = await prepare<Item>(`
    SELECT i.* FROM items i
    JOIN planning_item_initiative_link l ON l.item_id = i.id
    WHERE l.initiative_id = ?
    ORDER BY i.position ASC, i.created_at DESC
  `).all(initiativeId);
  if (linked.length === 0) return [];
  // Тянем подзадачи параллельно для всех parent'ов.
  const parentIds = linked.map((i) => i.id);
  const placeholders = parentIds.map(() => "?").join(",");
  const subtasks = await prepare<Item>(
    `SELECT * FROM items WHERE parent_id IN (${placeholders}) ORDER BY position ASC`
  ).all(...parentIds);
  // Дедуп: если subtask сам привязан к этой же инициативе, не дублируем.
  const seen = new Set(linked.map((i) => i.id));
  const merged = [...linked];
  for (const sub of subtasks) {
    if (!seen.has(sub.id)) { merged.push(sub); seen.add(sub.id); }
  }
  return merged;
}

// ---------------- Client deals (P8) ----------------
// «Сделка» — это запись на клиенте. У клиента может быть N сделок.
// Стадия = status_id (FK на client_statuses, те же что используются для самого клиента).
// Lifecycle (pilot/production/churned) определяется через мэппинг в planning_settings.

export async function listClientDeals(filter?: {
  clientId?: string;
  statusId?: string;
}): Promise<ClientDeal[]> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (filter?.clientId) { conditions.push("client_id = ?"); params.push(filter.clientId); }
  if (filter?.statusId) { conditions.push("status_id = ?"); params.push(filter.statusId); }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  return await prepare<ClientDeal>(
    `SELECT * FROM client_deals ${where} ORDER BY position ASC, created_at ASC`
  ).all(...params);
}

export async function getClientDeal(id: string): Promise<ClientDeal | undefined> {
  return await prepare<ClientDeal>("SELECT * FROM client_deals WHERE id = ?").get(id);
}

export async function createClientDeal(input: CreateClientDealInput): Promise<ClientDeal> {
  const settings = await getPlanningSettings();
  const defaultDur = input.pilot_default_duration_days ?? settings.pilot_default_duration_days ?? 30;
  const row = await prepare<ClientDeal>(`
    INSERT INTO client_deals (
      client_id, title, status_id, pilot_default_duration_days,
      min_monthly_amount, expected_actual_amount, description, position
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    RETURNING *
  `).get(
    input.client_id,
    input.title ?? "",
    input.status_id ?? null,
    defaultDur,
    input.min_monthly_amount ?? null,
    input.expected_actual_amount ?? null,
    input.description ?? null,
    input.position ?? 0,
  );
  return row!;
}

/**
 * P8: смена status_id запускает авто-fill timestamps lifecycle:
 *   - status_id переходит на pilot_status_id (из planning_settings):
 *       pilot_started_at = now() (если null)
 *       pilot_planned_end_at = pilot_started_at + pilot_default_duration_days
 *       status_changed_at = now()
 *   - status_id переходит на production_status_id:
 *       production_started_at = now() (если null)
 *       pilot_ended_at = now() (если был пилот и null)
 *       status_changed_at = now()
 *   - status_id переходит в churned_status_ids:
 *       просто status_changed_at = now()
 *
 * Логика на уровне application, не trigger — так проще тестировать и видеть в коде.
 */
export async function updateClientDeal(id: string, updates: UpdateClientDealInput): Promise<ClientDeal | undefined> {
  const before = await getClientDeal(id);
  if (!before) return undefined;

  const effective: Record<string, unknown> = { ...updates };
  if (updates.status_id !== undefined && updates.status_id !== before.status_id) {
    const settings = await getPlanningSettings();
    const now = new Date().toISOString();
    effective.status_changed_at = now;
    if (updates.status_id === settings.pilot_status_id) {
      if (!before.pilot_started_at) effective.pilot_started_at = now;
      const startedTs = before.pilot_started_at ? new Date(before.pilot_started_at).getTime() : Date.now();
      const days = updates.pilot_default_duration_days ?? before.pilot_default_duration_days;
      if (!before.pilot_planned_end_at) {
        effective.pilot_planned_end_at = new Date(startedTs + days * 86400000).toISOString();
      }
    } else if (updates.status_id === settings.production_status_id) {
      if (!before.production_started_at) effective.production_started_at = now;
      if (before.pilot_started_at && !before.pilot_ended_at) effective.pilot_ended_at = now;
    }
  }

  const built = buildUpdateClause(effective, CLIENT_DEAL_UPDATE_FIELDS);
  if (!built) return before;
  await prepare(`UPDATE client_deals SET ${built.sql} WHERE id = ?`).run(...built.values, id);
  return await getClientDeal(id);
}

export async function deleteClientDeal(id: string): Promise<boolean> {
  const r = await prepare("DELETE FROM client_deals WHERE id = ?").run(id);
  return r.changes > 0;
}

/**
 * P8: lifecycle stage сделки на основе её status_id и мэппинга в planning_settings.
 *   - status_id == pilot_status_id  → 'pilot'
 *   - status_id == production_status_id → 'production'
 *   - status_id ∈ churned_status_ids → 'churned'
 *   - иначе (null или прочие статусы) → 'pre_pilot'
 */
export function getClientDealLifecycleStage(deal: Pick<ClientDeal, "status_id">, settings: PlanningSettings): ClientDealLifecycleStage {
  if (!deal.status_id) return "pre_pilot";
  if (deal.status_id === settings.pilot_status_id) return "pilot";
  if (deal.status_id === settings.production_status_id) return "production";
  if (settings.churned_status_ids?.includes(deal.status_id)) return "churned";
  return "pre_pilot";
}

// ---------------- Client deal payments ----------------

export async function listClientDealPayments(
  dealId: string,
  filter?: { from?: string; to?: string; status?: ClientDealPayment["status"] },
): Promise<ClientDealPayment[]> {
  const conditions: string[] = ["deal_id = ?"];
  const params: unknown[] = [dealId];
  if (filter?.from) { conditions.push("paid_at >= ?"); params.push(filter.from); }
  if (filter?.to) { conditions.push("paid_at <= ?"); params.push(filter.to); }
  if (filter?.status) { conditions.push("status = ?"); params.push(filter.status); }
  return await prepare<ClientDealPayment>(
    `SELECT * FROM client_deal_payments WHERE ${conditions.join(" AND ")} ORDER BY paid_at DESC`
  ).all(...params);
}

/**
 * P8: все платежи клиента — джойн всех сделок клиента + их платежей.
 * Используется для таба «Платежи» в карточке клиента и для расчёта MRR.
 */
export async function listAllClientPayments(clientId: string): Promise<Array<ClientDealPayment & { deal_title: string }>> {
  return await prepare<ClientDealPayment & { deal_title: string }>(`
    SELECT p.*, d.title AS deal_title
    FROM client_deal_payments p
    JOIN client_deals d ON d.id = p.deal_id
    WHERE d.client_id = ?
    ORDER BY p.paid_at DESC
  `).all(clientId);
}

export async function addClientDealPayment(input: CreateClientDealPaymentInput): Promise<ClientDealPayment> {
  const row = await prepare<ClientDealPayment>(`
    INSERT INTO client_deal_payments (deal_id, paid_at, amount, note, status)
    VALUES (?, ?, ?, ?, ?)
    RETURNING *
  `).get(
    input.deal_id, input.paid_at, input.amount,
    input.note ?? null, input.status ?? "expected",
  );
  return row!;
}

export async function updateClientDealPayment(id: string, updates: UpdateClientDealPaymentInput): Promise<ClientDealPayment | undefined> {
  const built = buildUpdateClause(updates as Record<string, unknown>, CLIENT_DEAL_PAYMENT_UPDATE_FIELDS);
  if (!built) return await prepare<ClientDealPayment>("SELECT * FROM client_deal_payments WHERE id = ?").get(id);
  await prepare(`UPDATE client_deal_payments SET ${built.sql} WHERE id = ?`).run(...built.values, id);
  return await prepare<ClientDealPayment>("SELECT * FROM client_deal_payments WHERE id = ?").get(id);
}

export async function deleteClientDealPayment(id: string): Promise<boolean> {
  const r = await prepare("DELETE FROM client_deal_payments WHERE id = ?").run(id);
  return r.changes > 0;
}

/**
 * P8: список заблокированных клиентов — заменяет listBlockedDeals.
 * Возвращает клиентов, у которых есть активная связь к незакрытой инициативе.
 */
export async function listBlockedClients(): Promise<Array<{
  client_id: string;
  client_name: string;
  deal_id: string | null;
  deal_title: string | null;
  blocks_stage: DealBlockingStage | null;
  initiative_id: string;
  initiative_title: string;
  initiative_status: InitiativeStatus;
  end_date: string | null;
}>> {
  return await prepare<{
    client_id: string;
    client_name: string;
    deal_id: string | null;
    deal_title: string | null;
    blocks_stage: DealBlockingStage | null;
    initiative_id: string;
    initiative_title: string;
    initiative_status: InitiativeStatus;
    end_date: string | null;
  }>(`
    SELECT b.client_id, c.name AS client_name,
           b.deal_id, d.title AS deal_title, b.blocks_stage,
           i.id AS initiative_id, i.title AS initiative_title,
           i.status AS initiative_status, p.end_date
    FROM planning_initiative_client_block b
    JOIN clients c ON c.id = b.client_id
    LEFT JOIN client_deals d ON d.id = b.deal_id
    JOIN planning_initiatives i ON i.id = b.initiative_id
    LEFT JOIN planning_periods p ON p.id = i.end_period_id
    WHERE i.status NOT IN ('done', 'killed')
    ORDER BY p.end_date ASC NULLS LAST, c.name ASC
  `).all();
}

// ---------------- Change log ----------------

export async function appendChangeLog(input: ChangeLogInsertInput): Promise<PlanningChangeLogEntry> {
  const row = await prepare<PlanningChangeLogEntry>(`
    INSERT INTO planning_change_log (actor_email, entity_type, entity_id, action, diff, replan_reason, context)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    RETURNING *
  `).get(
    input.actor_email ?? null,
    input.entity_type, input.entity_id, input.action,
    input.diff ?? null, input.replan_reason ?? null, input.context ?? null,
  );
  return row!;
}

export async function listChangeLog(
  filter?: { entityType?: string; entityId?: string; actorEmail?: string; from?: string; to?: string },
  limit = 100,
  offset = 0,
): Promise<PlanningChangeLogEntry[]> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (filter?.entityType) { conditions.push("entity_type = ?"); params.push(filter.entityType); }
  if (filter?.entityId) { conditions.push("entity_id = ?"); params.push(filter.entityId); }
  if (filter?.actorEmail) { conditions.push("actor_email = ?"); params.push(filter.actorEmail); }
  if (filter?.from) { conditions.push("timestamp >= ?"); params.push(filter.from); }
  if (filter?.to) { conditions.push("timestamp <= ?"); params.push(filter.to); }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  params.push(Math.max(1, limit | 0), Math.max(0, offset | 0));
  return await prepare<PlanningChangeLogEntry>(
    `SELECT * FROM planning_change_log ${where} ORDER BY timestamp DESC LIMIT ? OFFSET ?`
  ).all(...params);
}

// ---------------- Settings ----------------

export async function getPlanningSettings(): Promise<PlanningSettings> {
  const row = await prepare<PlanningSettings>(
    "SELECT * FROM planning_settings WHERE id = 'default'"
  ).get();
  if (!row) {
    await prepare("INSERT INTO planning_settings (id) VALUES ('default') ON CONFLICT DO NOTHING").run();
    return (await prepare<PlanningSettings>(
      "SELECT * FROM planning_settings WHERE id = 'default'"
    ).get())!;
  }
  return row;
}

export async function updatePlanningSettings(updates: UpdatePlanningSettingsInput): Promise<PlanningSettings> {
  const built = buildUpdateClause(updates as Record<string, unknown>, PLANNING_SETTINGS_UPDATE_FIELDS);
  if (built) {
    await prepare(`UPDATE planning_settings SET ${built.sql}, updated_at = now() WHERE id = 'default'`)
      .run(...built.values);
  }
  return await getPlanningSettings();
}

// ---------------- ICP segments ----------------

export async function listIcpSegments(includeArchived = false): Promise<PlanningIcpSegment[]> {
  const where = includeArchived ? "" : "WHERE archived = false";
  return await prepare<PlanningIcpSegment>(
    `SELECT * FROM planning_icp_segments ${where} ORDER BY position ASC, created_at ASC`
  ).all();
}

export async function createIcpSegment(title: string): Promise<PlanningIcpSegment> {
  const row = await prepare<PlanningIcpSegment>(
    "INSERT INTO planning_icp_segments (title) VALUES (?) RETURNING *"
  ).get(title);
  return row!;
}

export async function updateIcpSegment(id: string, updates: { title?: string; archived?: boolean; position?: number }): Promise<PlanningIcpSegment | undefined> {
  const built = buildUpdateClause(updates as Record<string, unknown>, ["title", "archived", "position"] as const);
  if (!built) return await prepare<PlanningIcpSegment>("SELECT * FROM planning_icp_segments WHERE id = ?").get(id);
  await prepare(`UPDATE planning_icp_segments SET ${built.sql} WHERE id = ?`).run(...built.values, id);
  return await prepare<PlanningIcpSegment>("SELECT * FROM planning_icp_segments WHERE id = ?").get(id);
}

// ---------------- Replan reasons & metric units (dictionaries) ----------------

export async function listReplanReasons(): Promise<PlanningReplanReasonDict[]> {
  return await prepare<PlanningReplanReasonDict>(
    "SELECT * FROM planning_replan_reasons ORDER BY code ASC"
  ).all();
}

export async function listMetricUnits(): Promise<PlanningMetricUnit[]> {
  return await prepare<PlanningMetricUnit>(
    "SELECT * FROM planning_metric_units ORDER BY title ASC"
  ).all();
}

// ---------------- Kaiten board mapping ----------------

export async function listBoardMappings(): Promise<PlanningKaitenBoardMapping[]> {
  return await prepare<PlanningKaitenBoardMapping>(
    "SELECT * FROM planning_kaiten_board_mapping ORDER BY created_at ASC"
  ).all();
}

export async function upsertBoardMapping(kaitenBoardId: string, initiativeId: string): Promise<PlanningKaitenBoardMapping> {
  const row = await prepare<PlanningKaitenBoardMapping>(`
    INSERT INTO planning_kaiten_board_mapping (kaiten_board_id, initiative_id)
    VALUES (?, ?)
    ON CONFLICT (kaiten_board_id) DO UPDATE SET initiative_id = EXCLUDED.initiative_id
    RETURNING *
  `).get(kaitenBoardId, initiativeId);
  return row!;
}

export async function deleteBoardMapping(kaitenBoardId: string): Promise<boolean> {
  const r = await prepare("DELETE FROM planning_kaiten_board_mapping WHERE kaiten_board_id = ?").run(kaitenBoardId);
  return r.changes > 0;
}

export async function getInitiativeIdByKaitenBoard(boardId: string | number | null): Promise<string | undefined> {
  if (boardId == null) return undefined;
  const row = await prepare<{ initiative_id: string }>(
    "SELECT initiative_id FROM planning_kaiten_board_mapping WHERE kaiten_board_id = ?"
  ).get(String(boardId));
  return row?.initiative_id;
}

// ============================================================================
// Auto-create Support initiative for a quarter (concept §6.3).
// Returns existing or freshly created. Direction can be null for non-direction-scoped.
// ============================================================================
export async function findOrCreateSupportInitiative(
  directionId: string | null,
  refDate: Date = new Date(),
): Promise<PlanningInitiative | null> {
  const year = refDate.getUTCFullYear();
  const month = refDate.getUTCMonth(); // 0..11
  const quarter = Math.floor(month / 3) + 1;

  // Find quarterly period for current quarter.
  const periods = await listPeriods({ type: "quarter", year, directionId });
  const quarterPeriod = periods.find((p) => p.quarter_n === quarter);
  if (!quarterPeriod) return null; // No quarter period — can't anchor

  const title = `Поддержка Q${quarter} ${year}`;

  // Find existing.
  const conditions: string[] = ["type = 'support'", "title = ?", "due_period_id = ?"];
  const params: unknown[] = [title, quarterPeriod.id];
  if (directionId === null) {
    conditions.push("direction_id IS NULL");
  } else {
    conditions.push("direction_id = ?");
    params.push(directionId);
  }
  const existing = await prepare<PlanningInitiative>(
    `SELECT * FROM planning_initiatives WHERE ${conditions.join(" AND ")} LIMIT 1`
  ).get(...params);
  if (existing) return existing;

  // Create.
  return await createInitiative({
    direction_id: directionId,
    title,
    type: "support",
    due_period_id: quarterPeriod.id,
  });
}

/** Auto-link a task (items.id) without initiative_id to current Support Qx. */
export async function autoLinkOrphanTaskToSupport(itemId: string): Promise<string | null> {
  const item = await prepare<{ initiative_id: string | null; category: string | null }>(
    "SELECT initiative_id, category FROM items WHERE id = ?"
  ).get(itemId);
  if (!item || item.initiative_id) return null;
  // Use a global (direction_id = null) Support initiative — single inbox bucket.
  const support = await findOrCreateSupportInitiative(null);
  if (!support) return null;
  await prepare("UPDATE items SET initiative_id = ? WHERE id = ? AND initiative_id IS NULL").run(support.id, itemId);
  return support.id;
}
