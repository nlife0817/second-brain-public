import Database from "better-sqlite3";
import path from "path";
import { Item, Tag } from "@/types";

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
  `);
}

export function getAllItems(includeArchived = false): Item[] {
  const db = getDb();
  const where = includeArchived ? "" : "WHERE i.status != 'archived' AND i.parent_id IS NULL";
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
