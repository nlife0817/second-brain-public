import Database from "better-sqlite3";
import { randomUUID } from "crypto";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, "..", "data", "brain.db");

const dir = path.dirname(DB_PATH);
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS items (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    type TEXT NOT NULL DEFAULT 'task',
    status TEXT NOT NULL DEFAULT 'inbox',
    priority TEXT NOT NULL DEFAULT 'none',
    category TEXT NOT NULL DEFAULT 'other',
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

const now = new Date().toISOString();
const insert = db.prepare(`
  INSERT INTO items (id, title, description, type, status, priority, category, due_date, position, parent_id, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const items = [
  { title: "Подготовить КП для клиента Альфа", description: "Коммерческое предложение на разработку мобильного приложения. Бюджет: 500к.", type: "task", status: "in_progress", priority: "urgent", category: "clients", position: 0 },
  { title: "Рефакторинг модуля авторизации", description: "Перевести на JWT токены, убрать сессии из Redis.", type: "task", status: "todo", priority: "high", category: "development", position: 0 },
  { title: "Исследовать новые AI-фреймворки", description: "Сравнить LangChain, CrewAI, AutoGen для агентной системы.", type: "idea", status: "inbox", priority: "medium", category: "research", position: 0 },
  { title: "Созвон с командой по спринту", description: "Обсудить итоги спринта, блокеры, планы на следующую неделю.", type: "meeting", status: "review", priority: "medium", category: "projects", position: 0 },
  { title: "Обновить документацию API", description: "Добавить описание новых эндпоинтов v2.", type: "task", status: "done", priority: "low", category: "development", position: 0 },
  { title: "Разработать план миграции на микросервисы", description: "Определить границы сервисов, план поэтапного перехода.", type: "plan", status: "todo", priority: "high", category: "projects", position: 1 },
  { title: "Встреча с инвестором", description: "Презентация продукта, обсуждение условий.", type: "meeting", status: "inbox", priority: "urgent", category: "clients", position: 1, due_date: "2026-04-02" },
  { title: "Настроить CI/CD пайплайн", description: "GitHub Actions + Docker + автодеплой на staging.", type: "task", status: "in_progress", priority: "high", category: "development", position: 1 },
];

const parentIds = [];
const transaction = db.transaction(() => {
  for (const item of items) {
    const id = randomUUID();
    parentIds.push(id);
    insert.run(id, item.title, item.description, item.type, item.status, item.priority, item.category, item.due_date || null, item.position, null, now, now);
  }

  // Add subtasks for first item (КП для клиента)
  const subtasks = [
    "Собрать требования от клиента",
    "Оценить трудозатраты",
    "Составить смету",
    "Оформить презентацию",
    "Отправить на согласование",
  ];
  for (let i = 0; i < subtasks.length; i++) {
    const done = i < 2 ? "done" : "todo";
    insert.run(randomUUID(), subtasks[i], "", "task", done, "none", "clients", null, i, parentIds[0], now, now);
  }

  // Add subtasks for CI/CD
  const ciSubtasks = [
    "Написать Dockerfile",
    "Настроить GitHub Actions workflow",
    "Добавить тесты в пайплайн",
    "Настроить автодеплой",
  ];
  for (let i = 0; i < ciSubtasks.length; i++) {
    const done = i < 1 ? "done" : "todo";
    insert.run(randomUUID(), ciSubtasks[i], "", "task", done, "none", "development", null, i, parentIds[7], now, now);
  }

  // Add tags
  const tags = [
    { name: "срочно", color: "#ef4444" },
    { name: "бэкенд", color: "#3b82f6" },
    { name: "фронтенд", color: "#8b5cf6" },
    { name: "дизайн", color: "#ec4899" },
    { name: "инфра", color: "#f59e0b" },
    { name: "клиент", color: "#10b981" },
  ];
  const tagInsert = db.prepare("INSERT OR IGNORE INTO tags (id, name, color) VALUES (?, ?, ?)");
  for (const tag of tags) {
    tagInsert.run(randomUUID(), tag.name, tag.color);
  }
});

transaction();
console.log("Seed completed: 8 items + 9 subtasks + 6 tags");
db.close();
