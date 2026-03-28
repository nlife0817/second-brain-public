import Database from "better-sqlite3";
import path from "path";
import { Item, Tag, WeeklyPlan, WeeklyPlanEntry, WeeklyPlanEntryWithItem, WeeklyPlanFull, WeeklyPlanReport, EntryComment } from "@/types";

const DB_PATH = path.join(process.cwd(), "data", "brain.db");

let db: Database.Database | null = null;

function getDb(): Database.Database {
  if (!db) {
    const fs = require("fs");
    const dir = path.dirname(DB_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    db = new Database(DB_PATH);
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    initSchema(db);
  }
  return db;
}

function initSchema(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS items (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      type TEXT NOT NULL DEFAULT 'task' CHECK(type IN ('task','note','meeting','plan','idea')),
      status TEXT NOT NULL DEFAULT 'inbox' CHECK(status IN ('inbox','todo','in_progress','review','done','archived')),
      priority TEXT NOT NULL DEFAULT 'none' CHECK(priority IN ('urgent','high','medium','low','none')),
      category TEXT NOT NULL DEFAULT 'other' CHECK(category IN ('projects','development','clients','research','other')),
      due_date TEXT,
      position INTEGER NOT NULL DEFAULT 0,
      parent_id TEXT REFERENCES items(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS tags (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      color TEXT NOT NULL DEFAULT '#6b7280'
    );

    CREATE TABLE IF NOT EXISTS item_tags (
      item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
      tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
      PRIMARY KEY (item_id, tag_id)
    );

    CREATE INDEX IF NOT EXISTS idx_items_status ON items(status);
    CREATE INDEX IF NOT EXISTS idx_items_category ON items(category);
    CREATE INDEX IF NOT EXISTS idx_items_parent ON items(parent_id);
    CREATE INDEX IF NOT EXISTS idx_items_priority ON items(priority);

    CREATE TABLE IF NOT EXISTS weekly_plans (
      id TEXT PRIMARY KEY,
      week_start TEXT NOT NULL,
      week_end TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','completed','archived')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS weekly_plan_entries (
      id TEXT PRIMARY KEY,
      plan_id TEXT NOT NULL REFERENCES weekly_plans(id) ON DELETE CASCADE,
      item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
      position INTEGER NOT NULL DEFAULT 0,
      result_status TEXT NOT NULL DEFAULT 'pending' CHECK(result_status IN ('pending','done','not_done','transferred')),
      result_comment TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(plan_id, item_id)
    );

    CREATE TABLE IF NOT EXISTS entry_comments (
      id TEXT PRIMARY KEY,
      entry_id TEXT NOT NULL REFERENCES weekly_plan_entries(id) ON DELETE CASCADE,
      text TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_wp_status ON weekly_plans(status);
    CREATE INDEX IF NOT EXISTS idx_wp_week ON weekly_plans(week_start);
    CREATE INDEX IF NOT EXISTS idx_wpe_plan ON weekly_plan_entries(plan_id);
    CREATE INDEX IF NOT EXISTS idx_wpe_item ON weekly_plan_entries(item_id);
    CREATE INDEX IF NOT EXISTS idx_ec_entry ON entry_comments(entry_id);
  `);
}

export function getAllItems(includeArchived = false, includeChildren = false): Item[] {
  const db = getDb();
  const conditions: string[] = [];
  if (!includeArchived) conditions.push("i.status != 'archived'");
  if (!includeChildren) conditions.push("i.parent_id IS NULL");
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  return db.prepare(`SELECT * FROM items i ${where} ORDER BY position ASC, created_at DESC`).all() as Item[];
}

export function getItemById(id: string): Item | undefined {
  const db = getDb();
  return db.prepare("SELECT * FROM items WHERE id = ?").get(id) as Item | undefined;
}

export function getSubtasks(parentId: string): Item[] {
  const db = getDb();
  return db.prepare("SELECT * FROM items WHERE parent_id = ? ORDER BY position ASC").all(parentId) as Item[];
}

export function getItemTags(itemId: string): Tag[] {
  const db = getDb();
  return db.prepare(`
    SELECT t.* FROM tags t
    JOIN item_tags it ON t.id = it.tag_id
    WHERE it.item_id = ?
  `).all(itemId) as Tag[];
}

export function createItem(item: Omit<Item, "created_at" | "updated_at">): Item {
  const db = getDb();
  const now = new Date().toISOString();

  const maxPos = db.prepare(
    "SELECT COALESCE(MAX(position), -1) + 1 as next_pos FROM items WHERE status = ? AND parent_id IS ?"
  ).get(item.status, item.parent_id ?? null) as { next_pos: number };

  db.prepare(`
    INSERT INTO items (id, title, description, type, status, priority, category, due_date, position, parent_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    item.id, item.title, item.description, item.type, item.status,
    item.priority, item.category, item.due_date ?? null,
    item.position ?? maxPos.next_pos, item.parent_id ?? null, now, now
  );

  return getItemById(item.id)!;
}

export function updateItem(id: string, updates: Partial<Item>): Item | undefined {
  const db = getDb();
  const existing = getItemById(id);
  if (!existing) return undefined;

  const fields: string[] = [];
  const values: unknown[] = [];

  for (const [key, value] of Object.entries(updates)) {
    if (key === "id" || key === "created_at") continue;
    fields.push(`${key} = ?`);
    values.push(value);
  }

  if (fields.length === 0) return existing;

  fields.push("updated_at = ?");
  values.push(new Date().toISOString());
  values.push(id);

  db.prepare(`UPDATE items SET ${fields.join(", ")} WHERE id = ?`).run(...values);
  return getItemById(id);
}

export function deleteItem(id: string): boolean {
  const db = getDb();
  const result = db.prepare("DELETE FROM items WHERE id = ?").run(id);
  return result.changes > 0;
}

export function getAllTags(): Tag[] {
  const db = getDb();
  return db.prepare("SELECT * FROM tags ORDER BY name ASC").all() as Tag[];
}

export function createTag(tag: Tag): Tag {
  const db = getDb();
  db.prepare("INSERT OR IGNORE INTO tags (id, name, color) VALUES (?, ?, ?)").run(tag.id, tag.name, tag.color);
  return tag;
}

export function setItemTags(itemId: string, tagIds: string[]) {
  const db = getDb();
  const deleteStmt = db.prepare("DELETE FROM item_tags WHERE item_id = ?");
  const insertStmt = db.prepare("INSERT INTO item_tags (item_id, tag_id) VALUES (?, ?)");

  const transaction = db.transaction(() => {
    deleteStmt.run(itemId);
    for (const tagId of tagIds) {
      insertStmt.run(itemId, tagId);
    }
  });

  transaction();
}

export function reorderItems(items: { id: string; position: number; status?: string }[]) {
  const db = getDb();
  const stmt = db.prepare("UPDATE items SET position = ?, status = COALESCE(?, status), updated_at = ? WHERE id = ?");

  const transaction = db.transaction(() => {
    const now = new Date().toISOString();
    for (const item of items) {
      stmt.run(item.position, item.status ?? null, now, item.id);
    }
  });

  transaction();
}

// --- Weekly Plans ---

export function getAllWeeklyPlans(): WeeklyPlan[] {
  const db = getDb();
  return db.prepare("SELECT * FROM weekly_plans ORDER BY week_start DESC").all() as WeeklyPlan[];
}

export function getWeeklyPlanById(id: string): WeeklyPlan | undefined {
  const db = getDb();
  return db.prepare("SELECT * FROM weekly_plans WHERE id = ?").get(id) as WeeklyPlan | undefined;
}

export function getWeeklyPlanFull(id: string): WeeklyPlanFull | undefined {
  const db = getDb();
  const plan = getWeeklyPlanById(id);
  if (!plan) return undefined;

  const rows = db.prepare(`
    SELECT e.*, i.title as item_title, i.description as item_description,
           i.type as item_type, i.status as item_status, i.priority as item_priority,
           i.category as item_category, i.due_date as item_due_date,
           i.position as item_position, i.parent_id as item_parent_id,
           i.created_at as item_created_at, i.updated_at as item_updated_at
    FROM weekly_plan_entries e
    JOIN items i ON e.item_id = i.id
    WHERE e.plan_id = ?
    ORDER BY e.position ASC
  `).all(id) as (WeeklyPlanEntry & Record<string, unknown>)[];

  const commentsStmt = db.prepare(
    "SELECT * FROM entry_comments WHERE entry_id = ? ORDER BY created_at ASC"
  );

  const entries: WeeklyPlanEntryWithItem[] = rows.map((row) => {
    const entryId = row.id as string;
    const comments = commentsStmt.all(entryId) as EntryComment[];
    return {
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
        due_date: (row.item_due_date as string) || null,
        position: row.item_position as number,
        parent_id: (row.item_parent_id as string) || null,
        created_at: row.item_created_at as string,
        updated_at: row.item_updated_at as string,
      },
    };
  });

  return { ...plan, entries };
}

export function createWeeklyPlan(plan: Pick<WeeklyPlan, "id" | "week_start" | "week_end" | "title">): WeeklyPlan {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO weekly_plans (id, week_start, week_end, title, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'active', ?, ?)
  `).run(plan.id, plan.week_start, plan.week_end, plan.title, now, now);
  return getWeeklyPlanById(plan.id)!;
}

export function updateWeeklyPlan(id: string, updates: Partial<WeeklyPlan>): WeeklyPlan | undefined {
  const db = getDb();
  const existing = getWeeklyPlanById(id);
  if (!existing) return undefined;

  const fields: string[] = [];
  const values: unknown[] = [];

  for (const [key, value] of Object.entries(updates)) {
    if (key === "id" || key === "created_at") continue;
    fields.push(`${key} = ?`);
    values.push(value);
  }
  if (fields.length === 0) return existing;

  fields.push("updated_at = ?");
  values.push(new Date().toISOString());
  values.push(id);

  db.prepare(`UPDATE weekly_plans SET ${fields.join(", ")} WHERE id = ?`).run(...values);
  return getWeeklyPlanById(id);
}

export function deleteWeeklyPlan(id: string): boolean {
  const db = getDb();
  return db.prepare("DELETE FROM weekly_plans WHERE id = ?").run(id).changes > 0;
}

export function addItemToPlan(planId: string, itemId: string): WeeklyPlanEntry | null {
  const db = getDb();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  const maxPos = db.prepare(
    "SELECT COALESCE(MAX(position), -1) + 1 as next_pos FROM weekly_plan_entries WHERE plan_id = ?"
  ).get(planId) as { next_pos: number };

  try {
    db.prepare(`
      INSERT INTO weekly_plan_entries (id, plan_id, item_id, position, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, planId, itemId, maxPos.next_pos, now, now);
    return db.prepare("SELECT * FROM weekly_plan_entries WHERE id = ?").get(id) as WeeklyPlanEntry;
  } catch {
    return null; // UNIQUE constraint — already in plan
  }
}

export function bulkAddItemsToPlan(planId: string, itemIds: string[]): number {
  const db = getDb();
  const now = new Date().toISOString();
  let added = 0;

  const maxPos = db.prepare(
    "SELECT COALESCE(MAX(position), -1) + 1 as next_pos FROM weekly_plan_entries WHERE plan_id = ?"
  ).get(planId) as { next_pos: number };

  const stmt = db.prepare(`
    INSERT OR IGNORE INTO weekly_plan_entries (id, plan_id, item_id, position, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const transaction = db.transaction(() => {
    for (let i = 0; i < itemIds.length; i++) {
      const result = stmt.run(crypto.randomUUID(), planId, itemIds[i], maxPos.next_pos + i, now, now);
      added += result.changes;
    }
  });

  transaction();
  return added;
}

export function removeItemFromPlan(planId: string, itemId: string): boolean {
  const db = getDb();
  return db.prepare("DELETE FROM weekly_plan_entries WHERE plan_id = ? AND item_id = ?").run(planId, itemId).changes > 0;
}

export function updatePlanEntry(entryId: string, updates: Partial<Pick<WeeklyPlanEntry, "result_status" | "result_comment" | "position">>): WeeklyPlanEntry | undefined {
  const db = getDb();
  const fields: string[] = [];
  const values: unknown[] = [];

  for (const [key, value] of Object.entries(updates)) {
    fields.push(`${key} = ?`);
    values.push(value);
  }
  if (fields.length === 0) return undefined;

  fields.push("updated_at = ?");
  values.push(new Date().toISOString());
  values.push(entryId);

  db.prepare(`UPDATE weekly_plan_entries SET ${fields.join(", ")} WHERE id = ?`).run(...values);
  return db.prepare("SELECT * FROM weekly_plan_entries WHERE id = ?").get(entryId) as WeeklyPlanEntry | undefined;
}

export function getTransferableEntries(planId: string): WeeklyPlanEntryWithItem[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT e.*, i.title as item_title, i.description as item_description,
           i.type as item_type, i.status as item_status, i.priority as item_priority,
           i.category as item_category, i.due_date as item_due_date,
           i.position as item_position, i.parent_id as item_parent_id,
           i.created_at as item_created_at, i.updated_at as item_updated_at
    FROM weekly_plan_entries e
    JOIN items i ON e.item_id = i.id
    WHERE e.plan_id = ? AND e.result_status = 'transferred'
    ORDER BY e.position ASC
  `).all(planId) as (WeeklyPlanEntry & Record<string, unknown>)[];

  const commentsStmt = db.prepare(
    "SELECT * FROM entry_comments WHERE entry_id = ? ORDER BY created_at ASC"
  );

  return rows.map((row) => {
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
      comments: commentsStmt.all(entryId) as EntryComment[],
      item: {
        id: row.item_id as string,
        title: row.item_title as string,
        description: row.item_description as string,
        type: row.item_type as Item["type"],
        status: row.item_status as Item["status"],
        priority: row.item_priority as Item["priority"],
        category: row.item_category as Item["category"],
        due_date: (row.item_due_date as string) || null,
        position: row.item_position as number,
        parent_id: (row.item_parent_id as string) || null,
        created_at: row.item_created_at as string,
        updated_at: row.item_updated_at as string,
      },
    };
  });
}

export function getUnplannedDoneItems(weekStart: string, weekEnd: string, planId: string): Item[] {
  const db = getDb();
  return db.prepare(`
    SELECT i.* FROM items i
    WHERE i.status = 'done'
      AND i.updated_at >= ? AND i.updated_at < date(?, '+1 day')
      AND i.id NOT IN (SELECT item_id FROM weekly_plan_entries WHERE plan_id = ?)
      AND i.parent_id IS NULL
    ORDER BY i.updated_at DESC
  `).all(weekStart, weekEnd, planId) as Item[];
}

export function completeWeeklyPlan(planId: string): WeeklyPlanFull | undefined {
  const db = getDb();
  const plan = getWeeklyPlanFull(planId);
  if (!plan) return undefined;

  const now = new Date().toISOString();

  const transaction = db.transaction(() => {
    for (const entry of plan.entries) {
      if (entry.result_status !== "pending") continue;
      // Auto-detect: if item is done → mark entry done, otherwise → not_done
      const newStatus = entry.item.status === "done" ? "done" : "not_done";
      db.prepare("UPDATE weekly_plan_entries SET result_status = ?, updated_at = ? WHERE id = ?")
        .run(newStatus, now, entry.id);
    }
    // Mark plan as completed
    db.prepare("UPDATE weekly_plans SET status = 'completed', updated_at = ? WHERE id = ?")
      .run(now, planId);
  });

  transaction();
  return getWeeklyPlanFull(planId);
}

// --- Entry Comments ---

export function getEntryComments(entryId: string): EntryComment[] {
  const db = getDb();
  return db.prepare("SELECT * FROM entry_comments WHERE entry_id = ? ORDER BY created_at ASC").all(entryId) as EntryComment[];
}

export function addEntryComment(entryId: string, text: string): EntryComment {
  const db = getDb();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  db.prepare("INSERT INTO entry_comments (id, entry_id, text, created_at) VALUES (?, ?, ?, ?)").run(id, entryId, text, now);
  // Also update result_comment to last comment for backward compat
  db.prepare("UPDATE weekly_plan_entries SET result_comment = ?, updated_at = ? WHERE id = ?").run(text, now, entryId);
  return { id, entry_id: entryId, text, created_at: now };
}

export function deleteEntryComment(commentId: string): boolean {
  const db = getDb();
  return db.prepare("DELETE FROM entry_comments WHERE id = ?").run(commentId).changes > 0;
}

export function getWeeklyPlanReport(planId: string): WeeklyPlanReport | undefined {
  const plan = getWeeklyPlanFull(planId);
  if (!plan) return undefined;

  const done = plan.entries.filter((e) => e.result_status === "done");
  const not_done = plan.entries.filter((e) => e.result_status === "not_done");
  const transferred = plan.entries.filter((e) => e.result_status === "transferred");
  const unplanned_done = getUnplannedDoneItems(plan.week_start, plan.week_end, planId);
  const total = plan.entries.length;

  return {
    plan,
    done,
    not_done,
    transferred,
    unplanned_done,
    total,
    done_count: done.length,
    completion_rate: total > 0 ? Math.round((done.length / total) * 100) : 0,
  };
}
