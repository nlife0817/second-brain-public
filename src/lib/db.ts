import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { initBackupSchedule } from "./backup";
import {
  Item, ItemWithSubtasks, Tag, Category, CrmSystem, WeeklyPlan, WeeklyPlanEntry, WeeklyPlanEntryWithItem, WeeklyPlanFull, WeeklyPlanReport, EntryComment,
  Client, ClientFull, ClientStatus, ClientCompany, ClientContact, ClientContactField, ClientNote, ClientLink,
  ContactFieldType,
  RelationType, Relation, RelationWithTarget, Comment, EntityType,
  StagingItem, StagingEntityType, StagingStatus,
  IntegrationProvider, IntegrationSettings, IntegrationSettingsInput,
  SyncProfile, SyncProfileInput, SyncFieldMapping, SyncFieldMappingInput,
  ExternalEntityLink, ExternalSyncState, SyncEntityType, SyncDirection, KaitenImportResult,
  DevelopmentParticipant, DevelopmentParticipantInput, KaitenStageOption, SyncOutboxJob, SyncOutboxStatus,
} from "@/types";

export const DB_PATH = path.join(process.cwd(), "data", "brain.db");

let db: Database.Database | null = null;

function getDb(): Database.Database {
  if (!db) {
    const dir = path.dirname(DB_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    db = new Database(DB_PATH);
    db.pragma("journal_mode = WAL");
    db.pragma("synchronous = NORMAL");
    db.pragma("cache_size = -8000");
    db.pragma("temp_store = MEMORY");
    db.pragma("mmap_size = 268435456");
    db.pragma("foreign_keys = ON");
    initSchema(db);
    migrateSchema(db);
    initBackupSchedule(db, DB_PATH);
  }
  return db;
}

export function ensureDb(): void {
  getDb();
}

export function resetDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}

function initSchema(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS categories (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      color TEXT NOT NULL DEFAULT '#6b7280',
      icon TEXT NOT NULL DEFAULT 'Folder',
      position INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS items (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      type TEXT NOT NULL DEFAULT 'task' CHECK(type IN ('task','note','meeting','plan','idea')),
      status TEXT NOT NULL DEFAULT 'inbox' CHECK(status IN ('inbox','todo','in_progress','review','done','archived')),
      priority TEXT NOT NULL DEFAULT 'none' CHECK(priority IN ('urgent','high','medium','low','none')),
      category TEXT NOT NULL DEFAULT 'other',
      source TEXT NOT NULL DEFAULT 'system',
      development_stage TEXT,
      due_date TEXT,
      position INTEGER NOT NULL DEFAULT 0,
      parent_id TEXT REFERENCES items(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS tags (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      color TEXT NOT NULL DEFAULT '#6b7280',
      position INTEGER NOT NULL DEFAULT 0
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
    CREATE INDEX IF NOT EXISTS idx_items_development_stage ON items(development_stage);

    CREATE TABLE IF NOT EXISTS development_stages (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      position INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS development_participants (
      id TEXT PRIMARY KEY,
      provider TEXT,
      remote_id TEXT,
      name TEXT NOT NULL DEFAULT '',
      position INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(provider, remote_id)
    );

    CREATE TABLE IF NOT EXISTS item_development_participants (
      item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
      participant_id TEXT NOT NULL REFERENCES development_participants(id) ON DELETE CASCADE,
      PRIMARY KEY (item_id, participant_id)
    );

    CREATE INDEX IF NOT EXISTS idx_item_development_participants_item ON item_development_participants(item_id);

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

    -- Clients
    CREATE TABLE IF NOT EXISTS client_statuses (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      color TEXT NOT NULL DEFAULT '#6b7280',
      position INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS clients (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL DEFAULT '',
      status_id TEXT REFERENCES client_statuses(id) ON DELETE SET NULL,
      budget TEXT NOT NULL DEFAULT '',
      operators_per_shift TEXT NOT NULL DEFAULT '',
      operators_total TEXT NOT NULL DEFAULT '',
      calls_per_month TEXT NOT NULL DEFAULT '',
      crm_system TEXT NOT NULL DEFAULT '',
      position INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS client_companies (
      id TEXT PRIMARY KEY,
      client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
      name TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS client_contacts (
      id TEXT PRIMARY KEY,
      client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
      name TEXT NOT NULL DEFAULT '',
      position INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS client_contact_fields (
      id TEXT PRIMARY KEY,
      contact_id TEXT NOT NULL REFERENCES client_contacts(id) ON DELETE CASCADE,
      type TEXT NOT NULL DEFAULT 'email' CHECK(type IN ('email','phone','telegram','note')),
      value TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS client_notes (
      id TEXT PRIMARY KEY,
      client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
      text TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS client_links (
      id TEXT PRIMARY KEY,
      client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
      url TEXT NOT NULL DEFAULT '',
      title TEXT NOT NULL DEFAULT ''
    );

    CREATE INDEX IF NOT EXISTS idx_clients_status ON clients(status_id);
    CREATE INDEX IF NOT EXISTS idx_cc_client ON client_companies(client_id);
    CREATE INDEX IF NOT EXISTS idx_ccon_client ON client_contacts(client_id);
    CREATE INDEX IF NOT EXISTS idx_ccf_contact ON client_contact_fields(contact_id);
    CREATE INDEX IF NOT EXISTS idx_cn_client ON client_notes(client_id);
    CREATE INDEX IF NOT EXISTS idx_cl_client ON client_links(client_id);

    -- CRM systems
    CREATE TABLE IF NOT EXISTS crm_systems (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      position INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS client_crm_systems (
      client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
      crm_system_id TEXT NOT NULL REFERENCES crm_systems(id) ON DELETE CASCADE,
      PRIMARY KEY (client_id, crm_system_id)
    );

    CREATE INDEX IF NOT EXISTS idx_ccs_client ON client_crm_systems(client_id);

    -- Relation types (user-configurable)
    CREATE TABLE IF NOT EXISTS relation_types (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      color TEXT NOT NULL DEFAULT '#6b7280',
      icon TEXT NOT NULL DEFAULT 'Link',
      position INTEGER NOT NULL DEFAULT 0
    );

    -- Relations between entities (polymorphic: item <-> item, item <-> client, client <-> client)
    CREATE TABLE IF NOT EXISTS relations (
      id TEXT PRIMARY KEY,
      source_type TEXT NOT NULL CHECK(source_type IN ('item','client')),
      source_id TEXT NOT NULL,
      target_type TEXT NOT NULL CHECK(target_type IN ('item','client')),
      target_id TEXT NOT NULL,
      relation_type_id TEXT REFERENCES relation_types(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(source_type, source_id, target_type, target_id)
    );

    -- Comments on any entity (item or client)
    CREATE TABLE IF NOT EXISTS comments (
      id TEXT PRIMARY KEY,
      entity_type TEXT NOT NULL CHECK(entity_type IN ('item','client')),
      entity_id TEXT NOT NULL,
      text TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_rel_source ON relations(source_type, source_id);
    CREATE INDEX IF NOT EXISTS idx_rel_target ON relations(target_type, target_id);
    CREATE INDEX IF NOT EXISTS idx_rel_type ON relations(relation_type_id);
    CREATE INDEX IF NOT EXISTS idx_comments_entity ON comments(entity_type, entity_id);

    -- Staging (approval queue)
    CREATE TABLE IF NOT EXISTS staging_items (
      id TEXT PRIMARY KEY,
      entity_type TEXT NOT NULL DEFAULT 'item' CHECK(entity_type IN ('item','client')),
      title TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      parsed_data TEXT NOT NULL DEFAULT '{}',
      staging_status TEXT NOT NULL DEFAULT 'pending' CHECK(staging_status IN ('pending','approved','rejected')),
      batch_id TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_staging_status ON staging_items(staging_status);
    CREATE INDEX IF NOT EXISTS idx_staging_batch ON staging_items(batch_id);

    -- Integrations / external sync
    CREATE TABLE IF NOT EXISTS integration_settings (
      provider TEXT PRIMARY KEY,
      enabled INTEGER NOT NULL DEFAULT 0,
      company_domain TEXT NOT NULL DEFAULT '',
      api_base_url TEXT NOT NULL DEFAULT '',
      token_secret TEXT NOT NULL DEFAULT '',
      default_import_target TEXT NOT NULL DEFAULT 'staging' CHECK(default_import_target IN ('staging')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sync_profiles (
      id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      name TEXT NOT NULL DEFAULT '',
      entity_type TEXT NOT NULL DEFAULT 'item' CHECK(entity_type IN ('item','client')),
      source_space_id INTEGER,
      source_board_id INTEGER,
      import_enabled INTEGER NOT NULL DEFAULT 1,
      export_enabled INTEGER NOT NULL DEFAULT 0,
      sync_interval_minutes INTEGER NOT NULL DEFAULT 60,
      remote_wins_on_conflict INTEGER NOT NULL DEFAULT 1,
      source_statuses TEXT NOT NULL DEFAULT '[]',
      source_columns TEXT NOT NULL DEFAULT '[]',
      source_lanes TEXT NOT NULL DEFAULT '[]',
      available_development_stages TEXT NOT NULL DEFAULT '[]',
      available_participants TEXT NOT NULL DEFAULT '[]',
      last_catalog_synced_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_sync_profiles_provider ON sync_profiles(provider);

    CREATE TABLE IF NOT EXISTS sync_field_mappings (
      id TEXT PRIMARY KEY,
      profile_id TEXT NOT NULL REFERENCES sync_profiles(id) ON DELETE CASCADE,
      local_entity_type TEXT NOT NULL DEFAULT 'item' CHECK(local_entity_type IN ('item','client')),
      local_field TEXT NOT NULL,
      remote_field TEXT NOT NULL,
      direction TEXT NOT NULL DEFAULT 'import' CHECK(direction IN ('import','export','bidirectional')),
      transform_rule TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_sync_field_mappings_profile ON sync_field_mappings(profile_id);

    CREATE TABLE IF NOT EXISTS external_entity_links (
      id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      profile_id TEXT REFERENCES sync_profiles(id) ON DELETE SET NULL,
      local_entity_type TEXT NOT NULL CHECK(local_entity_type IN ('item','client')),
      local_entity_id TEXT NOT NULL,
      remote_entity_type TEXT NOT NULL DEFAULT 'card',
      remote_entity_id TEXT NOT NULL,
      remote_space_id INTEGER,
      remote_board_id INTEGER,
      remote_column_id INTEGER,
      remote_lane_id INTEGER,
      last_remote_updated_at TEXT,
      last_local_synced_at TEXT,
      sync_state TEXT NOT NULL DEFAULT 'pending' CHECK(sync_state IN ('active','pending','error','archived')),
      last_error TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(provider, remote_entity_type, remote_entity_id)
    );

    CREATE INDEX IF NOT EXISTS idx_external_links_local ON external_entity_links(local_entity_type, local_entity_id);
    CREATE INDEX IF NOT EXISTS idx_external_links_provider ON external_entity_links(provider);
    CREATE INDEX IF NOT EXISTS idx_external_links_profile ON external_entity_links(profile_id);

    CREATE TABLE IF NOT EXISTS sync_import_runs (
      id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      profile_id TEXT NOT NULL REFERENCES sync_profiles(id) ON DELETE CASCADE,
      batch_id TEXT NOT NULL,
      stats_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_sync_import_runs_profile ON sync_import_runs(profile_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS sync_outbox (
      id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      profile_id TEXT REFERENCES sync_profiles(id) ON DELETE SET NULL,
      local_entity_type TEXT NOT NULL CHECK(local_entity_type IN ('item','client')),
      local_entity_id TEXT NOT NULL,
      remote_entity_type TEXT NOT NULL DEFAULT 'card',
      remote_entity_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','processing','error')),
      attempts INTEGER NOT NULL DEFAULT 0,
      requested_at TEXT NOT NULL DEFAULT (datetime('now')),
      next_attempt_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_error TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(provider, local_entity_type, local_entity_id)
    );

    CREATE INDEX IF NOT EXISTS idx_sync_outbox_due ON sync_outbox(provider, status, next_attempt_at);

    -- Additional performance indexes
    CREATE INDEX IF NOT EXISTS idx_items_position ON items(position);
    CREATE INDEX IF NOT EXISTS idx_items_status_parent ON items(status, parent_id);
    CREATE INDEX IF NOT EXISTS idx_items_source ON items(source);
    CREATE INDEX IF NOT EXISTS idx_items_type ON items(type);
    CREATE INDEX IF NOT EXISTS idx_items_due_date ON items(due_date);
    CREATE INDEX IF NOT EXISTS idx_items_created_at ON items(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_item_tags_tag ON item_tags(tag_id);
    CREATE INDEX IF NOT EXISTS idx_item_dev_participants_participant ON item_development_participants(participant_id);
    CREATE INDEX IF NOT EXISTS idx_clients_position ON clients(position);
    CREATE INDEX IF NOT EXISTS idx_clients_created_at ON clients(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_client_crm_systems_crm ON client_crm_systems(crm_system_id);
    CREATE INDEX IF NOT EXISTS idx_comments_created_at ON comments(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_staging_entity_type ON staging_items(entity_type);
    CREATE INDEX IF NOT EXISTS idx_staging_updated_at ON staging_items(updated_at DESC);
  `);
}

function migrateSchema(db: Database.Database) {
  const itemCols = db.prepare("PRAGMA table_info(items)").all() as { name: string }[];
  const itemColNames = new Set(itemCols.map((c) => c.name));
  if (!itemColNames.has("development_stage")) {
    db.exec("ALTER TABLE items ADD COLUMN development_stage TEXT");
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS development_participants (
      id TEXT PRIMARY KEY,
      provider TEXT,
      remote_id TEXT,
      name TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(provider, remote_id)
    );

    CREATE TABLE IF NOT EXISTS item_development_participants (
      item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
      participant_id TEXT NOT NULL REFERENCES development_participants(id) ON DELETE CASCADE,
      PRIMARY KEY (item_id, participant_id)
    );

    CREATE INDEX IF NOT EXISTS idx_item_development_participants_item ON item_development_participants(item_id);
  `);

  const syncProfileCols = db.prepare("PRAGMA table_info(sync_profiles)").all() as { name: string }[];
  const syncProfileColNames = new Set(syncProfileCols.map((c) => c.name));
  if (!syncProfileColNames.has("sync_interval_minutes")) {
    db.exec("ALTER TABLE sync_profiles ADD COLUMN sync_interval_minutes INTEGER NOT NULL DEFAULT 60");
  }
  if (!syncProfileColNames.has("remote_wins_on_conflict")) {
    db.exec("ALTER TABLE sync_profiles ADD COLUMN remote_wins_on_conflict INTEGER NOT NULL DEFAULT 1");
  }
  if (!syncProfileColNames.has("available_development_stages")) {
    db.exec("ALTER TABLE sync_profiles ADD COLUMN available_development_stages TEXT NOT NULL DEFAULT '[]'");
  }
  if (!syncProfileColNames.has("available_participants")) {
    db.exec("ALTER TABLE sync_profiles ADD COLUMN available_participants TEXT NOT NULL DEFAULT '[]'");
  }
  if (!syncProfileColNames.has("last_catalog_synced_at")) {
    db.exec("ALTER TABLE sync_profiles ADD COLUMN last_catalog_synced_at TEXT");
  }
  db.exec(`
    UPDATE sync_profiles
    SET export_enabled = 1,
        sync_interval_minutes = CASE
          WHEN sync_interval_minutes IS NULL OR sync_interval_minutes < 5 THEN 60
          ELSE sync_interval_minutes
        END,
        remote_wins_on_conflict = 1
    WHERE provider = 'kaiten'
  `);

  const externalLinkCols = db.prepare("PRAGMA table_info(external_entity_links)").all() as { name: string }[];
  const externalLinkColNames = new Set(externalLinkCols.map((c) => c.name));
  if (!externalLinkColNames.has("profile_id")) {
    db.exec("ALTER TABLE external_entity_links ADD COLUMN profile_id TEXT REFERENCES sync_profiles(id) ON DELETE SET NULL");
  }
  db.exec("CREATE INDEX IF NOT EXISTS idx_external_links_profile ON external_entity_links(profile_id)");

  db.exec(`
    CREATE TABLE IF NOT EXISTS sync_outbox (
      id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      profile_id TEXT REFERENCES sync_profiles(id) ON DELETE SET NULL,
      local_entity_type TEXT NOT NULL CHECK(local_entity_type IN ('item','client')),
      local_entity_id TEXT NOT NULL,
      remote_entity_type TEXT NOT NULL DEFAULT 'card',
      remote_entity_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','processing','error')),
      attempts INTEGER NOT NULL DEFAULT 0,
      requested_at TEXT NOT NULL DEFAULT (datetime('now')),
      next_attempt_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_error TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(provider, local_entity_type, local_entity_id)
    );

    CREATE INDEX IF NOT EXISTS idx_sync_outbox_due ON sync_outbox(provider, status, next_attempt_at);
  `);

  // Add client params columns if they don't exist
  const cols = db.prepare("PRAGMA table_info(clients)").all() as { name: string }[];
  const colNames = new Set(cols.map((c) => c.name));
  const newCols = [
    { name: "budget", def: "TEXT NOT NULL DEFAULT ''" },
    { name: "operators_per_shift", def: "TEXT NOT NULL DEFAULT ''" },
    { name: "operators_total", def: "TEXT NOT NULL DEFAULT ''" },
    { name: "calls_per_month", def: "TEXT NOT NULL DEFAULT ''" },
    { name: "crm_system", def: "TEXT NOT NULL DEFAULT ''" },
  ];
  for (const col of newCols) {
    if (!colNames.has(col.name)) {
      db.exec(`ALTER TABLE clients ADD COLUMN ${col.name} ${col.def}`);
    }
  }

  // --- Categories table + items table recreation (remove CHECK on category, add source) ---
  const categoriesExists = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='categories'"
  ).get();

  if (!categoriesExists) {
    db.exec(`
      CREATE TABLE categories (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        color TEXT NOT NULL DEFAULT '#6b7280',
        icon TEXT NOT NULL DEFAULT 'Folder',
        position INTEGER NOT NULL DEFAULT 0
      );
    `);
  }
  seedDefaultCategories(db);

  // Check if items table has CHECK constraint on category (needs recreation)
  const itemsSql = (db.prepare(
    "SELECT sql FROM sqlite_master WHERE type='table' AND name='items'"
  ).get() as { sql: string } | undefined)?.sql ?? "";

  const needsRecreation = itemsSql.includes("CHECK(category");

  if (needsRecreation) {
    const hasSource = itemColNames.has("source");

    db.pragma("foreign_keys = OFF");
    db.exec("BEGIN TRANSACTION");
    try {
      db.exec(`
        CREATE TABLE items_new (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL DEFAULT '',
          description TEXT NOT NULL DEFAULT '',
          type TEXT NOT NULL DEFAULT 'task' CHECK(type IN ('task','note','meeting','plan','idea')),
          status TEXT NOT NULL DEFAULT 'inbox' CHECK(status IN ('inbox','todo','in_progress','review','done','archived')),
          priority TEXT NOT NULL DEFAULT 'none' CHECK(priority IN ('urgent','high','medium','low','none')),
          category TEXT NOT NULL DEFAULT 'other',
          source TEXT NOT NULL DEFAULT 'system',
          development_stage TEXT,
          due_date TEXT,
          position INTEGER NOT NULL DEFAULT 0,
          parent_id TEXT REFERENCES items(id) ON DELETE CASCADE,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
      `);

      if (hasSource) {
        db.exec(`
          INSERT INTO items_new (id, title, description, type, status, priority, category, source, development_stage, due_date, position, parent_id, created_at, updated_at)
          SELECT id, title, description, type, status, priority, category, source, development_stage, due_date, position, parent_id, created_at, updated_at FROM items;
        `);
      } else {
        db.exec(`
          INSERT INTO items_new (id, title, description, type, status, priority, category, source, development_stage, due_date, position, parent_id, created_at, updated_at)
          SELECT id, title, description, type, status, priority, category, 'system', development_stage, due_date, position, parent_id, created_at, updated_at FROM items;
        `);
      }

      db.exec("DROP TABLE items");
      db.exec("ALTER TABLE items_new RENAME TO items");

      // Recreate indexes
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_items_status ON items(status);
        CREATE INDEX IF NOT EXISTS idx_items_category ON items(category);
        CREATE INDEX IF NOT EXISTS idx_items_parent ON items(parent_id);
        CREATE INDEX IF NOT EXISTS idx_items_priority ON items(priority);
        CREATE INDEX IF NOT EXISTS idx_items_development_stage ON items(development_stage);
      `);

      // Backfill source for Kaiten-imported items
      db.exec(`
        UPDATE items SET source = 'kaiten'
        WHERE id IN (
          SELECT DISTINCT local_entity_id FROM external_entity_links
          WHERE local_entity_type = 'item' AND provider = 'kaiten'
        );
      `);

      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
    db.pragma("foreign_keys = ON");
  } else if (!itemColNames.has("source")) {
    // Items table already recreated but source missing (fresh DB shouldn't hit this)
    db.exec("ALTER TABLE items ADD COLUMN source TEXT NOT NULL DEFAULT 'system'");

    db.exec(`
      UPDATE items SET source = 'kaiten'
      WHERE id IN (
        SELECT DISTINCT local_entity_id FROM external_entity_links
        WHERE local_entity_type = 'item' AND provider = 'kaiten'
      );
    `);
  }

  // --- CRM systems migration ---
  const crmTableExists = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='crm_systems'"
  ).get();

  if (!crmTableExists) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS crm_systems (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        position INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS client_crm_systems (
        client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
        crm_system_id TEXT NOT NULL REFERENCES crm_systems(id) ON DELETE CASCADE,
        PRIMARY KEY (client_id, crm_system_id)
      );
      CREATE INDEX IF NOT EXISTS idx_ccs_client ON client_crm_systems(client_id);
    `);

    // Migrate existing text crm_system values to crm_systems table
    const existingValues = db.prepare(
      "SELECT DISTINCT crm_system FROM clients WHERE crm_system != '' AND crm_system IS NOT NULL"
    ).all() as { crm_system: string }[];

    if (existingValues.length > 0) {
      const insertCrm = db.prepare("INSERT OR IGNORE INTO crm_systems (id, name, position) VALUES (?, ?, ?)");
      const insertLink = db.prepare("INSERT OR IGNORE INTO client_crm_systems (client_id, crm_system_id) VALUES (?, ?)");
      const getClients = db.prepare("SELECT id FROM clients WHERE crm_system = ?");

      const transaction = db.transaction(() => {
        existingValues.forEach((row, idx) => {
          const crmId = crypto.randomUUID();
          insertCrm.run(crmId, row.crm_system.trim(), idx);
          const clients = getClients.all(row.crm_system) as { id: string }[];
          for (const client of clients) {
            insertLink.run(client.id, crmId);
          }
        });
      });
      transaction();
    }
  }

  // --- Tags position migration ---
  const tagCols = db.prepare("PRAGMA table_info(tags)").all() as { name: string }[];
  const tagColNames = new Set(tagCols.map((c) => c.name));
  if (!tagColNames.has("position")) {
    db.exec("ALTER TABLE tags ADD COLUMN position INTEGER NOT NULL DEFAULT 0");
    // Assign positions based on existing name order
    const tags = db.prepare("SELECT id FROM tags ORDER BY name ASC").all() as { id: string }[];
    const updateStmt = db.prepare("UPDATE tags SET position = ? WHERE id = ?");
    const txn = db.transaction(() => {
      tags.forEach((t, i) => updateStmt.run(i, t.id));
    });
    txn();
  }

  // --- Development stages table ---
  db.exec(`
    CREATE TABLE IF NOT EXISTS development_stages (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      position INTEGER NOT NULL DEFAULT 0
    );
  `);
  // Seed from existing items.development_stage values
  const stagesCount = (db.prepare("SELECT COUNT(*) as c FROM development_stages").get() as { c: number }).c;
  if (stagesCount === 0) {
    const existingStages = db.prepare(
      "SELECT DISTINCT development_stage FROM items WHERE development_stage IS NOT NULL AND development_stage != ''"
    ).all() as { development_stage: string }[];
    if (existingStages.length > 0) {
      const insertStage = db.prepare("INSERT OR IGNORE INTO development_stages (id, name, position) VALUES (?, ?, ?)");
      const txn2 = db.transaction(() => {
        existingStages.forEach((s, i) => insertStage.run(crypto.randomUUID(), s.development_stage, i));
      });
      txn2();
    }
  }

  // --- Participants position migration ---
  const partCols = db.prepare("PRAGMA table_info(development_participants)").all() as { name: string }[];
  const partColNames = new Set(partCols.map((c) => c.name));
  if (!partColNames.has("position")) {
    db.exec("ALTER TABLE development_participants ADD COLUMN position INTEGER NOT NULL DEFAULT 0");
    const parts = db.prepare("SELECT id FROM development_participants ORDER BY name ASC").all() as { id: string }[];
    const updatePart = db.prepare("UPDATE development_participants SET position = ? WHERE id = ?");
    const txn3 = db.transaction(() => {
      parts.forEach((p, i) => updatePart.run(i, p.id));
    });
    txn3();
  }
}

function seedDefaultCategories(db: Database.Database) {
  const count = (db.prepare("SELECT COUNT(*) as c FROM categories").get() as { c: number }).c;
  if (count > 0) return;

  const stmt = db.prepare("INSERT INTO categories (id, name, color, icon, position) VALUES (?, ?, ?, ?, ?)");
  const defaults = [
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
  const transaction = db.transaction(() => {
    for (const [id, name, color, icon, position] of defaults) {
      stmt.run(id, name, color, icon, position);
    }
  });
  transaction();
}

function parseJsonArray(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map((item) => String(item)) : [];
  } catch {
    return [];
  }
}

function parseJsonValue<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
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
  provider: string;
  enabled: number;
  company_domain: string;
  api_base_url: string;
  token_secret: string;
  default_import_target: "staging";
  created_at: string;
  updated_at: string;
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

export function getItemParticipants(itemId: string): DevelopmentParticipant[] {
  const db = getDb();
  return db.prepare(`
    SELECT p.* FROM development_participants p
    JOIN item_development_participants ip ON p.id = ip.participant_id
    WHERE ip.item_id = ?
    ORDER BY p.name COLLATE NOCASE ASC
  `).all(itemId) as DevelopmentParticipant[];
}

/** Batch-оптимизированная загрузка всех items с subtasks, tags, participants за 4 запроса вместо N*3 */
export function getAllItemsFull(includeArchived = false, includeChildren = false): ItemWithSubtasks[] {
  const db = getDb();

  // 1. Все top-level items
  const conditions: string[] = [];
  if (!includeArchived) conditions.push("i.status != 'archived'");
  if (!includeChildren) conditions.push("i.parent_id IS NULL");
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const items = db.prepare(`SELECT * FROM items i ${where} ORDER BY position ASC, created_at DESC`).all() as Item[];

  if (items.length === 0) return [];

  const itemIds = items.map((i) => i.id);

  // 2. Все subtasks одним запросом
  const allSubtasks = db.prepare(
    `SELECT * FROM items WHERE parent_id IS NOT NULL ORDER BY position ASC`
  ).all() as Item[];
  const subtaskMap = new Map<string, Item[]>();
  for (const sub of allSubtasks) {
    if (!sub.parent_id) continue;
    const list = subtaskMap.get(sub.parent_id);
    if (list) list.push(sub);
    else subtaskMap.set(sub.parent_id, [sub]);
  }

  // 3. Все tags одним запросом
  const allItemTags = db.prepare(`
    SELECT it.item_id, t.* FROM tags t
    JOIN item_tags it ON t.id = it.tag_id
  `).all() as (Tag & { item_id: string })[];
  const tagMap = new Map<string, Tag[]>();
  for (const row of allItemTags) {
    const list = tagMap.get(row.item_id);
    const tag: Tag = { id: row.id, name: row.name, color: row.color, position: row.position };
    if (list) list.push(tag);
    else tagMap.set(row.item_id, [tag]);
  }

  // 4. Все participants одним запросом
  const allItemParticipants = db.prepare(`
    SELECT ip.item_id, p.* FROM development_participants p
    JOIN item_development_participants ip ON p.id = ip.participant_id
    ORDER BY p.name COLLATE NOCASE ASC
  `).all() as (DevelopmentParticipant & { item_id: string })[];
  const participantMap = new Map<string, DevelopmentParticipant[]>();
  for (const row of allItemParticipants) {
    const p: DevelopmentParticipant = { id: row.id, provider: row.provider, remote_id: row.remote_id, name: row.name, position: row.position, created_at: row.created_at, updated_at: row.updated_at };
    const list = participantMap.get(row.item_id);
    if (list) list.push(p);
    else participantMap.set(row.item_id, [p]);
  }

  // Собираем результат
  return items.map((item) => ({
    ...item,
    subtasks: subtaskMap.get(item.id) ?? [],
    tags: tagMap.get(item.id) ?? [],
    participants: participantMap.get(item.id) ?? [],
  }));
}

/** Возвращает один item с subtasks/tags/participants (для ответа на create/update) */
export function getItemFull(id: string): ItemWithSubtasks | undefined {
  const item = getItemById(id);
  if (!item) return undefined;
  return {
    ...item,
    subtasks: getSubtasks(item.id),
    tags: getItemTags(item.id),
    participants: getItemParticipants(item.id),
  };
}

export function setItemParticipants(itemId: string, participants: DevelopmentParticipantInput[]): DevelopmentParticipant[] {
  const db = getDb();
  const now = new Date().toISOString();
  const deleteStmt = db.prepare("DELETE FROM item_development_participants WHERE item_id = ?");
  const findByRemoteStmt = db.prepare(
    "SELECT * FROM development_participants WHERE provider IS ? AND remote_id IS ?"
  );
  const findByNameStmt = db.prepare(
    "SELECT * FROM development_participants WHERE provider IS NULL AND remote_id IS NULL AND name = ?"
  );
  const insertParticipantStmt = db.prepare(`
    INSERT INTO development_participants (id, provider, remote_id, name, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const updateParticipantStmt = db.prepare(`
    UPDATE development_participants SET name = ?, updated_at = ? WHERE id = ?
  `);
  const attachStmt = db.prepare(
    "INSERT OR IGNORE INTO item_development_participants (item_id, participant_id) VALUES (?, ?)"
  );

  const normalized = participants
    .map((participant) => ({
      provider: participant.provider ?? null,
      remote_id: participant.remote_id ?? null,
      name: participant.name.trim(),
    }))
    .filter((participant) => participant.name.length > 0);

  const transaction = db.transaction(() => {
    deleteStmt.run(itemId);

    for (const participant of normalized) {
      const existing = participant.remote_id
        ? findByRemoteStmt.get(participant.provider, participant.remote_id) as DevelopmentParticipant | undefined
        : findByNameStmt.get(participant.name) as DevelopmentParticipant | undefined;

      let participantId: string;
      if (existing) {
        participantId = existing.id;
        if (existing.name !== participant.name) {
          updateParticipantStmt.run(participant.name, now, participantId);
        }
      } else {
        participantId = crypto.randomUUID();
        insertParticipantStmt.run(
          participantId,
          participant.provider,
          participant.remote_id,
          participant.name,
          now,
          now
        );
      }

      attachStmt.run(itemId, participantId);
    }
  });

  transaction();
  return getItemParticipants(itemId);
}

export function createItem(item: Omit<Item, "created_at" | "updated_at">): Item {
  const db = getDb();
  const now = new Date().toISOString();

  const maxPos = db.prepare(
    "SELECT COALESCE(MAX(position), -1) + 1 as next_pos FROM items WHERE status = ? AND parent_id IS ?"
  ).get(item.status, item.parent_id ?? null) as { next_pos: number };

  db.prepare(`
    INSERT INTO items (id, title, description, type, status, priority, category, source, development_stage, due_date, position, parent_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    item.id, item.title, item.description, item.type, item.status,
    item.priority, item.category, item.source ?? "system", item.development_stage ?? null, item.due_date ?? null,
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
  return db.prepare("SELECT * FROM tags ORDER BY position ASC, name ASC").all() as Tag[];
}

export function createTag(tag: Pick<Tag, "id" | "name" | "color">): Tag {
  const db = getDb();
  const maxPos = db.prepare("SELECT COALESCE(MAX(position), -1) + 1 as p FROM tags").get() as { p: number };
  db.prepare("INSERT OR IGNORE INTO tags (id, name, color, position) VALUES (?, ?, ?, ?)").run(tag.id, tag.name, tag.color, maxPos.p);
  return db.prepare("SELECT * FROM tags WHERE id = ?").get(tag.id) as Tag;
}

export function updateTag(id: string, updates: Partial<Pick<Tag, "name" | "color" | "position">>): Tag | undefined {
  const db = getDb();
  const fields: string[] = [];
  const values: unknown[] = [];
  for (const [key, value] of Object.entries(updates)) {
    fields.push(`${key} = ?`);
    values.push(value);
  }
  if (fields.length === 0) return db.prepare("SELECT * FROM tags WHERE id = ?").get(id) as Tag | undefined;
  values.push(id);
  db.prepare(`UPDATE tags SET ${fields.join(", ")} WHERE id = ?`).run(...values);
  return db.prepare("SELECT * FROM tags WHERE id = ?").get(id) as Tag | undefined;
}

export function deleteTag(id: string): boolean {
  const db = getDb();
  db.prepare("DELETE FROM item_tags WHERE tag_id = ?").run(id);
  const result = db.prepare("DELETE FROM tags WHERE id = ?").run(id);
  return result.changes > 0;
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

// --- Development Stages CRUD ---

export interface DevelopmentStage {
  id: string;
  name: string;
  position: number;
}

export function getAllDevelopmentStages(): DevelopmentStage[] {
  const db = getDb();
  return db.prepare("SELECT * FROM development_stages ORDER BY position ASC").all() as DevelopmentStage[];
}

export function createDevelopmentStage(data: { id: string; name: string }): DevelopmentStage {
  const db = getDb();
  const maxPos = db.prepare("SELECT COALESCE(MAX(position), -1) + 1 as p FROM development_stages").get() as { p: number };
  db.prepare("INSERT INTO development_stages (id, name, position) VALUES (?, ?, ?)").run(data.id, data.name, maxPos.p);
  return db.prepare("SELECT * FROM development_stages WHERE id = ?").get(data.id) as DevelopmentStage;
}

export function updateDevelopmentStage(id: string, updates: Partial<Pick<DevelopmentStage, "name" | "position">>): DevelopmentStage | undefined {
  const db = getDb();
  const fields: string[] = [];
  const values: unknown[] = [];
  for (const [key, value] of Object.entries(updates)) {
    fields.push(`${key} = ?`);
    values.push(value);
  }
  if (fields.length === 0) return db.prepare("SELECT * FROM development_stages WHERE id = ?").get(id) as DevelopmentStage | undefined;
  values.push(id);
  db.prepare(`UPDATE development_stages SET ${fields.join(", ")} WHERE id = ?`).run(...values);
  return db.prepare("SELECT * FROM development_stages WHERE id = ?").get(id) as DevelopmentStage | undefined;
}

export function deleteDevelopmentStage(id: string): boolean {
  const db = getDb();
  const result = db.prepare("DELETE FROM development_stages WHERE id = ?").run(id);
  return result.changes > 0;
}

// --- Development Participants management ---

export function getAllDevelopmentParticipants(): DevelopmentParticipant[] {
  const db = getDb();
  return db.prepare("SELECT * FROM development_participants ORDER BY position ASC, name COLLATE NOCASE ASC").all() as DevelopmentParticipant[];
}

export function updateDevelopmentParticipant(id: string, updates: Partial<Pick<DevelopmentParticipant, "name" | "position">>): DevelopmentParticipant | undefined {
  const db = getDb();
  const fields: string[] = [];
  const values: unknown[] = [];
  for (const [key, value] of Object.entries(updates)) {
    fields.push(`${key} = ?`);
    values.push(value);
  }
  if (fields.length === 0) return db.prepare("SELECT * FROM development_participants WHERE id = ?").get(id) as DevelopmentParticipant | undefined;
  fields.push("updated_at = ?");
  values.push(new Date().toISOString());
  values.push(id);
  db.prepare(`UPDATE development_participants SET ${fields.join(", ")} WHERE id = ?`).run(...values);
  return db.prepare("SELECT * FROM development_participants WHERE id = ?").get(id) as DevelopmentParticipant | undefined;
}

export function deleteDevelopmentParticipant(id: string): boolean {
  const db = getDb();
  db.prepare("DELETE FROM item_development_participants WHERE participant_id = ?").run(id);
  const result = db.prepare("DELETE FROM development_participants WHERE id = ?").run(id);
  return result.changes > 0;
}

export function createDevelopmentParticipant(name: string): DevelopmentParticipant {
  const db = getDb();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const maxPos = db.prepare("SELECT COALESCE(MAX(position), -1) + 1 as p FROM development_participants").get() as { p: number };
  db.prepare("INSERT INTO development_participants (id, provider, remote_id, name, position, created_at, updated_at) VALUES (?, NULL, NULL, ?, ?, ?, ?)").run(id, name, maxPos.p, now, now);
  return db.prepare("SELECT * FROM development_participants WHERE id = ?").get(id) as DevelopmentParticipant;
}

// --- Categories CRUD ---

export function getAllCategories(): Category[] {
  const db = getDb();
  return db.prepare("SELECT * FROM categories ORDER BY position ASC").all() as Category[];
}

export function getCategoryById(id: string): Category | undefined {
  const db = getDb();
  return db.prepare("SELECT * FROM categories WHERE id = ?").get(id) as Category | undefined;
}

export function createCategory(cat: Omit<Category, "position">): Category {
  const db = getDb();
  const maxPos = db.prepare("SELECT COALESCE(MAX(position), -1) + 1 as next_pos FROM categories").get() as { next_pos: number };
  db.prepare("INSERT INTO categories (id, name, color, icon, position) VALUES (?, ?, ?, ?, ?)").run(
    cat.id, cat.name, cat.color, cat.icon, maxPos.next_pos
  );
  return getCategoryById(cat.id)!;
}

export function updateCategory(id: string, updates: Partial<Pick<Category, "name" | "color" | "icon" | "position">>): Category | undefined {
  const db = getDb();
  const existing = getCategoryById(id);
  if (!existing) return undefined;

  const fields: string[] = [];
  const values: unknown[] = [];
  for (const [key, value] of Object.entries(updates)) {
    fields.push(`${key} = ?`);
    values.push(value);
  }
  if (fields.length === 0) return existing;
  values.push(id);
  db.prepare(`UPDATE categories SET ${fields.join(", ")} WHERE id = ?`).run(...values);
  return getCategoryById(id);
}

export function deleteCategory(id: string): boolean {
  const db = getDb();
  // Move items from deleted category to 'other'
  db.prepare("UPDATE items SET category = 'other' WHERE category = ?").run(id);
  const result = db.prepare("DELETE FROM categories WHERE id = ?").run(id);
  return result.changes > 0;
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
           i.category as item_category, i.source as item_source, i.development_stage as item_development_stage, i.due_date as item_due_date,
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
        source: (row.item_source as Item["source"]) || "system",
        development_stage: (row.item_development_stage as string) || null,
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
           i.category as item_category, i.source as item_source, i.development_stage as item_development_stage, i.due_date as item_due_date,
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
        source: (row.item_source as Item["source"]) || "system",
        development_stage: (row.item_development_stage as string) || null,
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

// --- Client Statuses ---

export function getAllClientStatuses(): ClientStatus[] {
  const db = getDb();
  return db.prepare("SELECT * FROM client_statuses ORDER BY position ASC").all() as ClientStatus[];
}

export function createClientStatus(status: Pick<ClientStatus, "id" | "name" | "color">): ClientStatus {
  const db = getDb();
  const maxPos = db.prepare("SELECT COALESCE(MAX(position), -1) + 1 as p FROM client_statuses").get() as { p: number };
  db.prepare("INSERT INTO client_statuses (id, name, color, position) VALUES (?, ?, ?, ?)").run(status.id, status.name, status.color, maxPos.p);
  return db.prepare("SELECT * FROM client_statuses WHERE id = ?").get(status.id) as ClientStatus;
}

export function updateClientStatus(id: string, updates: Partial<Pick<ClientStatus, "name" | "color" | "position">>): ClientStatus | undefined {
  const db = getDb();
  const fields: string[] = [];
  const values: unknown[] = [];
  for (const [key, value] of Object.entries(updates)) {
    fields.push(`${key} = ?`);
    values.push(value);
  }
  if (fields.length === 0) return db.prepare("SELECT * FROM client_statuses WHERE id = ?").get(id) as ClientStatus | undefined;
  values.push(id);
  db.prepare(`UPDATE client_statuses SET ${fields.join(", ")} WHERE id = ?`).run(...values);
  return db.prepare("SELECT * FROM client_statuses WHERE id = ?").get(id) as ClientStatus | undefined;
}

export function deleteClientStatus(id: string): boolean {
  const db = getDb();
  return db.prepare("DELETE FROM client_statuses WHERE id = ?").run(id).changes > 0;
}

// --- Clients ---

export function getAllClients(): Client[] {
  const db = getDb();
  return db.prepare("SELECT * FROM clients ORDER BY position ASC, created_at DESC").all() as Client[];
}

export function getClientById(id: string): Client | undefined {
  const db = getDb();
  return db.prepare("SELECT * FROM clients WHERE id = ?").get(id) as Client | undefined;
}

export function getClientFull(id: string): ClientFull | undefined {
  const db = getDb();
  const client = getClientById(id);
  if (!client) return undefined;

  const status = client.status_id
    ? (db.prepare("SELECT * FROM client_statuses WHERE id = ?").get(client.status_id) as ClientStatus | undefined) ?? null
    : null;

  const companies = db.prepare("SELECT * FROM client_companies WHERE client_id = ?").all(id) as ClientCompany[];

  const contactRows = db.prepare("SELECT * FROM client_contacts WHERE client_id = ? ORDER BY position ASC").all(id) as ClientContact[];
  const fieldStmt = db.prepare("SELECT * FROM client_contact_fields WHERE contact_id = ?");
  const contacts: ClientContact[] = contactRows.map((c) => ({
    ...c,
    fields: fieldStmt.all(c.id) as ClientContactField[],
  }));

  const notes = db.prepare("SELECT * FROM client_notes WHERE client_id = ? ORDER BY created_at DESC").all(id) as ClientNote[];
  const links = db.prepare("SELECT * FROM client_links WHERE client_id = ?").all(id) as ClientLink[];
  const crm_systems = getClientCrmSystems(id);

  return { ...client, status, companies, contacts, notes, links, crm_systems };
}

export function getAllClientsFull(): ClientFull[] {
  const db = getDb();
  const clients = getAllClients();
  if (clients.length === 0) return [];

  const statusMap = new Map<string, ClientStatus>();
  for (const s of getAllClientStatuses()) statusMap.set(s.id, s);

  // Batch: все companies
  const allCompanies = db.prepare("SELECT * FROM client_companies").all() as ClientCompany[];
  const companyMap = new Map<string, ClientCompany[]>();
  for (const c of allCompanies) {
    const list = companyMap.get(c.client_id);
    if (list) list.push(c); else companyMap.set(c.client_id, [c]);
  }

  // Batch: все contacts + fields
  const allContacts = db.prepare("SELECT * FROM client_contacts ORDER BY position ASC").all() as ClientContact[];
  const allFields = db.prepare("SELECT * FROM client_contact_fields").all() as ClientContactField[];
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

  // Batch: все notes
  const allNotes = db.prepare("SELECT * FROM client_notes ORDER BY created_at DESC").all() as ClientNote[];
  const noteMap = new Map<string, ClientNote[]>();
  for (const n of allNotes) {
    const list = noteMap.get(n.client_id);
    if (list) list.push(n); else noteMap.set(n.client_id, [n]);
  }

  // Batch: все links
  const allLinks = db.prepare("SELECT * FROM client_links").all() as ClientLink[];
  const linkMap = new Map<string, ClientLink[]>();
  for (const l of allLinks) {
    const list = linkMap.get(l.client_id);
    if (list) list.push(l); else linkMap.set(l.client_id, [l]);
  }

  // Batch: все crm systems
  const allCrmLinks = db.prepare(`
    SELECT ccs.client_id, cs.* FROM crm_systems cs
    JOIN client_crm_systems ccs ON cs.id = ccs.crm_system_id
    ORDER BY cs.position ASC
  `).all() as (CrmSystem & { client_id: string })[];
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

export function createClient(data: {
  id: string; name: string; status_id?: string | null;
  budget?: string; operators_per_shift?: string; operators_total?: string;
  calls_per_month?: string; crm_system?: string;
}): Client {
  const db = getDb();
  const now = new Date().toISOString();
  const maxPos = db.prepare("SELECT COALESCE(MAX(position), -1) + 1 as p FROM clients").get() as { p: number };
  db.prepare(`INSERT INTO clients (id, name, status_id, budget, operators_per_shift, operators_total, calls_per_month, crm_system, position, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(data.id, data.name, data.status_id ?? null,
      data.budget ?? "", data.operators_per_shift ?? "", data.operators_total ?? "",
      data.calls_per_month ?? "", data.crm_system ?? "",
      maxPos.p, now, now);
  return getClientById(data.id)!;
}

export function updateClient(id: string, updates: Partial<Omit<Client, "id" | "created_at">>): Client | undefined {
  const db = getDb();
  const existing = getClientById(id);
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
  db.prepare(`UPDATE clients SET ${fields.join(", ")} WHERE id = ?`).run(...values);
  return getClientById(id);
}

export function deleteClient(id: string): boolean {
  const db = getDb();
  return db.prepare("DELETE FROM clients WHERE id = ?").run(id).changes > 0;
}

export function reorderClients(updates: { id: string; position: number; status_id?: string }[]) {
  const db = getDb();
  const stmt = db.prepare("UPDATE clients SET position = ?, status_id = COALESCE(?, status_id), updated_at = ? WHERE id = ?");
  const transaction = db.transaction(() => {
    const now = new Date().toISOString();
    for (const u of updates) {
      stmt.run(u.position, u.status_id ?? null, now, u.id);
    }
  });
  transaction();
}

// --- CRM Systems CRUD ---

export function getAllCrmSystems(): CrmSystem[] {
  const db = getDb();
  return db.prepare("SELECT * FROM crm_systems ORDER BY position ASC").all() as CrmSystem[];
}

export function createCrmSystem(data: { id: string; name: string }): CrmSystem {
  const db = getDb();
  const maxPos = db.prepare("SELECT COALESCE(MAX(position), -1) + 1 as p FROM crm_systems").get() as { p: number };
  db.prepare("INSERT INTO crm_systems (id, name, position) VALUES (?, ?, ?)").run(data.id, data.name, maxPos.p);
  return db.prepare("SELECT * FROM crm_systems WHERE id = ?").get(data.id) as CrmSystem;
}

export function updateCrmSystem(id: string, updates: Partial<Pick<CrmSystem, "name" | "position">>): CrmSystem | undefined {
  const db = getDb();
  const fields: string[] = [];
  const values: unknown[] = [];
  for (const [key, value] of Object.entries(updates)) {
    fields.push(`${key} = ?`);
    values.push(value);
  }
  if (fields.length === 0) return db.prepare("SELECT * FROM crm_systems WHERE id = ?").get(id) as CrmSystem | undefined;
  values.push(id);
  db.prepare(`UPDATE crm_systems SET ${fields.join(", ")} WHERE id = ?`).run(...values);
  return db.prepare("SELECT * FROM crm_systems WHERE id = ?").get(id) as CrmSystem | undefined;
}

export function deleteCrmSystem(id: string): boolean {
  const db = getDb();
  const result = db.prepare("DELETE FROM crm_systems WHERE id = ?").run(id);
  return result.changes > 0;
}

export function getClientCrmSystems(clientId: string): CrmSystem[] {
  const db = getDb();
  return db.prepare(`
    SELECT cs.* FROM crm_systems cs
    JOIN client_crm_systems ccs ON cs.id = ccs.crm_system_id
    WHERE ccs.client_id = ? ORDER BY cs.position ASC
  `).all(clientId) as CrmSystem[];
}

export function setClientCrmSystems(clientId: string, crmSystemIds: string[]) {
  const db = getDb();
  const deleteStmt = db.prepare("DELETE FROM client_crm_systems WHERE client_id = ?");
  const insertStmt = db.prepare("INSERT OR IGNORE INTO client_crm_systems (client_id, crm_system_id) VALUES (?, ?)");
  const transaction = db.transaction(() => {
    deleteStmt.run(clientId);
    for (const crmId of crmSystemIds) {
      insertStmt.run(clientId, crmId);
    }
  });
  transaction();
}

// Sync nested client data (replace-all strategy within a transaction)
export function syncClientNested(clientId: string, data: {
  companies?: { id?: string; name: string }[];
  contacts?: { id?: string; name: string; fields?: { id?: string; type: ContactFieldType; value: string }[] }[];
  notes?: { id?: string; text: string }[];
  links?: { id?: string; url: string; title: string }[];
}) {
  const db = getDb();
  const now = new Date().toISOString();

  const transaction = db.transaction(() => {
    if (data.companies !== undefined) {
      db.prepare("DELETE FROM client_companies WHERE client_id = ?").run(clientId);
      const stmt = db.prepare("INSERT INTO client_companies (id, client_id, name) VALUES (?, ?, ?)");
      for (const c of data.companies) {
        stmt.run(c.id ?? crypto.randomUUID(), clientId, c.name);
      }
    }

    if (data.contacts !== undefined) {
      // Get existing contact IDs to cascade-delete their fields
      db.prepare("DELETE FROM client_contacts WHERE client_id = ?").run(clientId);
      const contactStmt = db.prepare("INSERT INTO client_contacts (id, client_id, name, position) VALUES (?, ?, ?, ?)");
      const fieldStmt = db.prepare("INSERT INTO client_contact_fields (id, contact_id, type, value) VALUES (?, ?, ?, ?)");
      for (let i = 0; i < data.contacts.length; i++) {
        const contact = data.contacts[i];
        const contactId = contact.id ?? crypto.randomUUID();
        contactStmt.run(contactId, clientId, contact.name, i);
        if (contact.fields) {
          for (const f of contact.fields) {
            fieldStmt.run(f.id ?? crypto.randomUUID(), contactId, f.type, f.value);
          }
        }
      }
    }

    if (data.notes !== undefined) {
      db.prepare("DELETE FROM client_notes WHERE client_id = ?").run(clientId);
      const stmt = db.prepare("INSERT INTO client_notes (id, client_id, text, created_at) VALUES (?, ?, ?, ?)");
      for (const n of data.notes) {
        stmt.run(n.id ?? crypto.randomUUID(), clientId, n.text, now);
      }
    }

    if (data.links !== undefined) {
      db.prepare("DELETE FROM client_links WHERE client_id = ?").run(clientId);
      const stmt = db.prepare("INSERT INTO client_links (id, client_id, url, title) VALUES (?, ?, ?, ?)");
      for (const l of data.links) {
        stmt.run(l.id ?? crypto.randomUUID(), clientId, l.url, l.title);
      }
    }

    db.prepare("UPDATE clients SET updated_at = ? WHERE id = ?").run(now, clientId);
  });

  transaction();
}

// --- Relation Types ---

export function getAllRelationTypes(): RelationType[] {
  const db = getDb();
  return db.prepare("SELECT * FROM relation_types ORDER BY position ASC").all() as RelationType[];
}

export function createRelationType(rt: Pick<RelationType, "id" | "name" | "color" | "icon">): RelationType {
  const db = getDb();
  const maxPos = db.prepare("SELECT COALESCE(MAX(position), -1) + 1 as p FROM relation_types").get() as { p: number };
  db.prepare("INSERT INTO relation_types (id, name, color, icon, position) VALUES (?, ?, ?, ?, ?)").run(rt.id, rt.name, rt.color, rt.icon, maxPos.p);
  return db.prepare("SELECT * FROM relation_types WHERE id = ?").get(rt.id) as RelationType;
}

export function updateRelationType(id: string, updates: Partial<Pick<RelationType, "name" | "color" | "icon" | "position">>): RelationType | undefined {
  const db = getDb();
  const fields: string[] = [];
  const values: unknown[] = [];
  for (const [key, value] of Object.entries(updates)) {
    fields.push(`${key} = ?`);
    values.push(value);
  }
  if (fields.length === 0) return db.prepare("SELECT * FROM relation_types WHERE id = ?").get(id) as RelationType | undefined;
  values.push(id);
  db.prepare(`UPDATE relation_types SET ${fields.join(", ")} WHERE id = ?`).run(...values);
  return db.prepare("SELECT * FROM relation_types WHERE id = ?").get(id) as RelationType | undefined;
}

export function deleteRelationType(id: string): boolean {
  const db = getDb();
  return db.prepare("DELETE FROM relation_types WHERE id = ?").run(id).changes > 0;
}

// --- Relations ---

function resolveRelationTarget(r: Relation): RelationWithTarget {
  const db = getDb();
  let targetTitle = "";
  if (r.target_type === "item") {
    const item = db.prepare("SELECT title FROM items WHERE id = ?").get(r.target_id) as { title: string } | undefined;
    targetTitle = item?.title ?? "";
  } else {
    const client = db.prepare("SELECT name FROM clients WHERE id = ?").get(r.target_id) as { name: string } | undefined;
    targetTitle = client?.name ?? "";
  }
  const relType = r.relation_type_id
    ? (db.prepare("SELECT * FROM relation_types WHERE id = ?").get(r.relation_type_id) as RelationType | undefined) ?? null
    : null;
  return { ...r, target_title: targetTitle, relation_type: relType };
}

export function getRelationsForEntity(entityType: EntityType, entityId: string): RelationWithTarget[] {
  const db = getDb();
  // Get relations where this entity is source OR target
  const asSource = db.prepare(
    "SELECT * FROM relations WHERE source_type = ? AND source_id = ? ORDER BY created_at DESC"
  ).all(entityType, entityId) as Relation[];

  const asTarget = db.prepare(
    "SELECT * FROM relations WHERE target_type = ? AND target_id = ? ORDER BY created_at DESC"
  ).all(entityType, entityId) as Relation[];

  // For "as target" rows, flip so the "other" side becomes the target in our view
  const flipped: Relation[] = asTarget.map((r) => ({
    ...r,
    source_type: r.target_type,
    source_id: r.target_id,
    target_type: r.source_type,
    target_id: r.source_id,
  }));

  const all = [...asSource, ...flipped];
  // Deduplicate (in case source→target and target→source both exist, shouldn't normally)
  const seen = new Set<string>();
  const unique: Relation[] = [];
  for (const r of all) {
    const key = `${r.target_type}:${r.target_id}`;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(r);
    }
  }

  return unique.map(resolveRelationTarget);
}

export function getRelationCount(entityType: EntityType, entityId: string): number {
  const db = getDb();
  const r1 = db.prepare("SELECT COUNT(*) as c FROM relations WHERE source_type = ? AND source_id = ?").get(entityType, entityId) as { c: number };
  const r2 = db.prepare("SELECT COUNT(*) as c FROM relations WHERE target_type = ? AND target_id = ?").get(entityType, entityId) as { c: number };
  return r1.c + r2.c;
}

export function getRelationCountsBatch(entityType: EntityType): Record<string, number> {
  const db = getDb();
  const counts: Record<string, number> = {};
  const asSource = db.prepare("SELECT source_id, COUNT(*) as c FROM relations WHERE source_type = ? GROUP BY source_id").all(entityType) as { source_id: string; c: number }[];
  const asTarget = db.prepare("SELECT target_id, COUNT(*) as c FROM relations WHERE target_type = ? GROUP BY target_id").all(entityType) as { target_id: string; c: number }[];
  for (const r of asSource) counts[r.source_id] = (counts[r.source_id] ?? 0) + r.c;
  for (const r of asTarget) counts[r.target_id] = (counts[r.target_id] ?? 0) + r.c;
  return counts;
}

export function getCommentCountsBatch(entityType: EntityType): Record<string, number> {
  const db = getDb();
  const rows = db.prepare("SELECT entity_id, COUNT(*) as c FROM comments WHERE entity_type = ? GROUP BY entity_id").all(entityType) as { entity_id: string; c: number }[];
  const counts: Record<string, number> = {};
  for (const r of rows) counts[r.entity_id] = r.c;
  return counts;
}

export function getRelationTitlesBatch(entityType: EntityType): Record<string, string[]> {
  const db = getDb();
  const result: Record<string, string[]> = {};

  const asSource = db.prepare(
    "SELECT source_id, target_type, target_id FROM relations WHERE source_type = ?"
  ).all(entityType) as { source_id: string; target_type: string; target_id: string }[];

  const asTarget = db.prepare(
    "SELECT target_id, source_type, source_id FROM relations WHERE target_type = ?"
  ).all(entityType) as { target_id: string; source_type: string; source_id: string }[];

  function resolveTitle(type: string, id: string): string {
    if (type === "item") {
      const row = db.prepare("SELECT title FROM items WHERE id = ?").get(id) as { title: string } | undefined;
      return row?.title ?? "";
    }
    const row = db.prepare("SELECT name FROM clients WHERE id = ?").get(id) as { name: string } | undefined;
    return row?.name ?? "";
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

export function createRelation(data: { id: string; source_type: EntityType; source_id: string; target_type: EntityType; target_id: string; relation_type_id?: string | null }): Relation | null {
  const db = getDb();
  const now = new Date().toISOString();
  try {
    db.prepare(
      "INSERT INTO relations (id, source_type, source_id, target_type, target_id, relation_type_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).run(data.id, data.source_type, data.source_id, data.target_type, data.target_id, data.relation_type_id ?? null, now);
    return db.prepare("SELECT * FROM relations WHERE id = ?").get(data.id) as Relation;
  } catch {
    return null; // UNIQUE constraint
  }
}

export function updateRelation(id: string, updates: { relation_type_id?: string | null }): Relation | undefined {
  const db = getDb();
  if (updates.relation_type_id !== undefined) {
    db.prepare("UPDATE relations SET relation_type_id = ? WHERE id = ?").run(updates.relation_type_id, id);
  }
  return db.prepare("SELECT * FROM relations WHERE id = ?").get(id) as Relation | undefined;
}

export function deleteRelation(id: string): boolean {
  const db = getDb();
  return db.prepare("DELETE FROM relations WHERE id = ?").run(id).changes > 0;
}

// --- Comments (universal) ---

export function getComments(entityType: EntityType, entityId: string): Comment[] {
  const db = getDb();
  return db.prepare("SELECT * FROM comments WHERE entity_type = ? AND entity_id = ? ORDER BY created_at ASC").all(entityType, entityId) as Comment[];
}

export function getCommentCount(entityType: EntityType, entityId: string): number {
  const db = getDb();
  const r = db.prepare("SELECT COUNT(*) as c FROM comments WHERE entity_type = ? AND entity_id = ?").get(entityType, entityId) as { c: number };
  return r.c;
}

export function createComment(data: { id: string; entity_type: EntityType; entity_id: string; text: string }): Comment {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare("INSERT INTO comments (id, entity_type, entity_id, text, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)").run(data.id, data.entity_type, data.entity_id, data.text, now, now);
  return db.prepare("SELECT * FROM comments WHERE id = ?").get(data.id) as Comment;
}

export function updateComment(id: string, text: string): Comment | undefined {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare("UPDATE comments SET text = ?, updated_at = ? WHERE id = ?").run(text, now, id);
  return db.prepare("SELECT * FROM comments WHERE id = ?").get(id) as Comment | undefined;
}

export function deleteComment(id: string): boolean {
  const db = getDb();
  return db.prepare("DELETE FROM comments WHERE id = ?").run(id).changes > 0;
}

// ======================== Integrations ========================

export function getIntegrationSettings(provider: IntegrationProvider = "kaiten"): IntegrationSettings {
  const db = getDb();
  const row = db.prepare("SELECT * FROM integration_settings WHERE provider = ?").get(provider) as {
    provider: string;
    enabled: number;
    company_domain: string;
    api_base_url: string;
    token_secret: string;
    default_import_target: "staging";
    created_at: string;
    updated_at: string;
  } | undefined;
  return mapIntegrationSettings(row);
}

export function getIntegrationToken(provider: IntegrationProvider = "kaiten"): string {
  const db = getDb();
  const row = db.prepare("SELECT token_secret FROM integration_settings WHERE provider = ?").get(provider) as { token_secret: string } | undefined;
  return row?.token_secret ?? "";
}

export function upsertIntegrationSettings(provider: IntegrationProvider, input: IntegrationSettingsInput): IntegrationSettings {
  const db = getDb();
  const now = new Date().toISOString();
  const existing = db.prepare("SELECT * FROM integration_settings WHERE provider = ?").get(provider) as {
    token_secret: string;
  } | undefined;
  const companyDomain = input.company_domain.trim().replace(/^https?:\/\//, "").replace(/\.kaiten\.ru\/?$/, "");
  const tokenSecret = input.clear_token ? "" : (input.token !== undefined ? input.token.trim() : existing?.token_secret ?? "");
  const apiBaseUrl = buildApiBaseUrl(companyDomain);

  db.prepare(`
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

  return getIntegrationSettings(provider);
}

function mapSyncProfile(row: {
  id: string;
  provider: string;
  name: string;
  entity_type: SyncEntityType;
  source_space_id: number | null;
  source_board_id: number | null;
  import_enabled: number;
  export_enabled: number;
  sync_interval_minutes: number;
  remote_wins_on_conflict: number;
  source_statuses: string;
  source_columns: string;
  source_lanes: string;
  available_development_stages: string;
  available_participants: string;
  last_catalog_synced_at: string | null;
  created_at: string;
  updated_at: string;
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

export function getAllSyncProfiles(provider: IntegrationProvider = "kaiten"): SyncProfile[] {
  const db = getDb();
  const rows = db.prepare("SELECT * FROM sync_profiles WHERE provider = ? ORDER BY created_at ASC").all(provider) as {
    id: string;
    provider: string;
    name: string;
    entity_type: SyncEntityType;
    source_space_id: number | null;
    source_board_id: number | null;
    import_enabled: number;
    export_enabled: number;
    sync_interval_minutes: number;
    remote_wins_on_conflict: number;
    source_statuses: string;
    source_columns: string;
    source_lanes: string;
    available_development_stages: string;
    available_participants: string;
    last_catalog_synced_at: string | null;
    created_at: string;
    updated_at: string;
  }[];
  return rows.map(mapSyncProfile);
}

export function getSyncProfileById(id: string): SyncProfile | undefined {
  const db = getDb();
  const row = db.prepare("SELECT * FROM sync_profiles WHERE id = ?").get(id) as {
    id: string;
    provider: string;
    name: string;
    entity_type: SyncEntityType;
    source_space_id: number | null;
    source_board_id: number | null;
    import_enabled: number;
    export_enabled: number;
    sync_interval_minutes: number;
    remote_wins_on_conflict: number;
    source_statuses: string;
    source_columns: string;
    source_lanes: string;
    available_development_stages: string;
    available_participants: string;
    last_catalog_synced_at: string | null;
    created_at: string;
    updated_at: string;
  } | undefined;
  return row ? mapSyncProfile(row) : undefined;
}

export function upsertSyncProfile(provider: IntegrationProvider, input: SyncProfileInput): SyncProfile {
  const db = getDb();
  const now = new Date().toISOString();
  const id = input.id ?? crypto.randomUUID();
  db.prepare(`
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
    id,
    provider,
    input.name.trim(),
    input.entity_type ?? "item",
    input.source_space_id ?? null,
    input.source_board_id ?? null,
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
    now,
    now
  );

  return getSyncProfileById(id)!;
}

export function mapSyncField(row: {
  id: string;
  profile_id: string;
  local_entity_type: SyncEntityType;
  local_field: string;
  remote_field: string;
  direction: SyncDirection;
  transform_rule: string | null;
  created_at: string;
  updated_at: string;
}): SyncFieldMapping {
  return {
    id: row.id,
    profile_id: row.profile_id,
    local_entity_type: row.local_entity_type,
    local_field: row.local_field,
    remote_field: row.remote_field,
    direction: row.direction,
    transform_rule: row.transform_rule,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function getSyncFieldMappings(profileId: string): SyncFieldMapping[] {
  const db = getDb();
  const rows = db.prepare("SELECT * FROM sync_field_mappings WHERE profile_id = ? ORDER BY created_at ASC").all(profileId) as {
    id: string;
    profile_id: string;
    local_entity_type: SyncEntityType;
    local_field: string;
    remote_field: string;
    direction: SyncDirection;
    transform_rule: string | null;
    created_at: string;
    updated_at: string;
  }[];
  return rows.map(mapSyncField);
}

export function replaceSyncFieldMappings(profileId: string, mappings: SyncFieldMappingInput[]): SyncFieldMapping[] {
  const db = getDb();
  const now = new Date().toISOString();
  const deleteStmt = db.prepare("DELETE FROM sync_field_mappings WHERE profile_id = ?");
  const insertStmt = db.prepare(`
    INSERT INTO sync_field_mappings (
      id, profile_id, local_entity_type, local_field, remote_field, direction, transform_rule, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  db.transaction(() => {
    deleteStmt.run(profileId);
    for (const mapping of mappings) {
      insertStmt.run(
        mapping.id ?? crypto.randomUUID(),
        profileId,
        mapping.local_entity_type ?? "item",
        mapping.local_field,
        mapping.remote_field,
        mapping.direction ?? "import",
        mapping.transform_rule ?? null,
        now,
        now
      );
    }
  })();

  return getSyncFieldMappings(profileId);
}

function mapExternalEntityLink(row: {
  id: string;
  provider: string;
  profile_id: string | null;
  local_entity_type: SyncEntityType;
  local_entity_id: string;
  remote_entity_type: string;
  remote_entity_id: string;
  remote_space_id: number | null;
  remote_board_id: number | null;
  remote_column_id: number | null;
  remote_lane_id: number | null;
  last_remote_updated_at: string | null;
  last_local_synced_at: string | null;
  sync_state: ExternalSyncState;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}): ExternalEntityLink {
  return {
    id: row.id,
    provider: row.provider as IntegrationProvider,
    profile_id: row.profile_id,
    local_entity_type: row.local_entity_type,
    local_entity_id: row.local_entity_id,
    remote_entity_type: row.remote_entity_type,
    remote_entity_id: row.remote_entity_id,
    remote_space_id: row.remote_space_id,
    remote_board_id: row.remote_board_id,
    remote_column_id: row.remote_column_id,
    remote_lane_id: row.remote_lane_id,
    last_remote_updated_at: row.last_remote_updated_at,
    last_local_synced_at: row.last_local_synced_at,
    sync_state: row.sync_state,
    last_error: row.last_error,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function getExternalEntityLinkByRemote(provider: IntegrationProvider, remoteEntityType: string, remoteEntityId: string): ExternalEntityLink | undefined {
  const db = getDb();
  const row = db.prepare(
    "SELECT * FROM external_entity_links WHERE provider = ? AND remote_entity_type = ? AND remote_entity_id = ?"
  ).get(provider, remoteEntityType, remoteEntityId) as {
    id: string;
    provider: string;
    profile_id: string | null;
    local_entity_type: SyncEntityType;
    local_entity_id: string;
    remote_entity_type: string;
    remote_entity_id: string;
    remote_space_id: number | null;
    remote_board_id: number | null;
    remote_column_id: number | null;
    remote_lane_id: number | null;
    last_remote_updated_at: string | null;
    last_local_synced_at: string | null;
    sync_state: ExternalSyncState;
    last_error: string | null;
    created_at: string;
    updated_at: string;
  } | undefined;
  return row ? mapExternalEntityLink(row) : undefined;
}

export function getExternalEntityLinkByLocal(provider: IntegrationProvider, localEntityType: SyncEntityType, localEntityId: string): ExternalEntityLink | undefined {
  const db = getDb();
  const row = db.prepare(
    "SELECT * FROM external_entity_links WHERE provider = ? AND local_entity_type = ? AND local_entity_id = ?"
  ).get(provider, localEntityType, localEntityId) as {
    id: string;
    provider: string;
    profile_id: string | null;
    local_entity_type: SyncEntityType;
    local_entity_id: string;
    remote_entity_type: string;
    remote_entity_id: string;
    remote_space_id: number | null;
    remote_board_id: number | null;
    remote_column_id: number | null;
    remote_lane_id: number | null;
    last_remote_updated_at: string | null;
    last_local_synced_at: string | null;
    sync_state: ExternalSyncState;
    last_error: string | null;
    created_at: string;
    updated_at: string;
  } | undefined;
  return row ? mapExternalEntityLink(row) : undefined;
}

export function upsertExternalEntityLink(input: {
  provider: IntegrationProvider;
  profile_id?: string | null;
  local_entity_type: SyncEntityType;
  local_entity_id: string;
  remote_entity_type: string;
  remote_entity_id: string;
  remote_space_id?: number | null;
  remote_board_id?: number | null;
  remote_column_id?: number | null;
  remote_lane_id?: number | null;
  last_remote_updated_at?: string | null;
  last_local_synced_at?: string | null;
  sync_state?: ExternalSyncState;
  last_error?: string | null;
}): ExternalEntityLink {
  const db = getDb();
  const existing = getExternalEntityLinkByRemote(input.provider, input.remote_entity_type, input.remote_entity_id);
  const id = existing?.id ?? crypto.randomUUID();
  const createdAt = existing?.created_at ?? new Date().toISOString();
  const now = new Date().toISOString();

  db.prepare(`
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
    id,
    input.provider,
    input.profile_id ?? existing?.profile_id ?? null,
    input.local_entity_type,
    input.local_entity_id,
    input.remote_entity_type,
    input.remote_entity_id,
    input.remote_space_id ?? null,
    input.remote_board_id ?? null,
    input.remote_column_id ?? null,
    input.remote_lane_id ?? null,
    input.last_remote_updated_at ?? null,
    input.last_local_synced_at ?? null,
    input.sync_state ?? "pending",
    input.last_error ?? null,
    createdAt,
    now
  );

  return getExternalEntityLinkByRemote(input.provider, input.remote_entity_type, input.remote_entity_id)!;
}

export function rebindExternalEntityLinks(localEntityType: SyncEntityType, oldLocalEntityId: string, newLocalEntityId: string) {
  const db = getDb();
  db.prepare(`
    UPDATE external_entity_links
    SET local_entity_id = ?, sync_state = 'active', last_local_synced_at = ?, updated_at = ?
    WHERE local_entity_type = ? AND local_entity_id = ?
  `).run(newLocalEntityId, new Date().toISOString(), new Date().toISOString(), localEntityType, oldLocalEntityId);
}

export function saveSyncImportRun(provider: IntegrationProvider, profileId: string, result: KaitenImportResult) {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO sync_import_runs (id, provider, profile_id, batch_id, stats_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(crypto.randomUUID(), provider, profileId, result.batch_id, JSON.stringify(result), now);
}

export function getLatestSyncImportRun(profileId: string): KaitenImportResult | null {
  const db = getDb();
  const row = db.prepare(
    "SELECT stats_json FROM sync_import_runs WHERE profile_id = ? ORDER BY created_at DESC LIMIT 1"
  ).get(profileId) as { stats_json: string } | undefined;
  if (!row?.stats_json) return null;
  try {
    return JSON.parse(row.stats_json) as KaitenImportResult;
  } catch {
    return null;
  }
}

export function getSyncProfileByBoard(provider: IntegrationProvider, boardId: number): SyncProfile | undefined {
  const db = getDb();
  const row = db.prepare(
    "SELECT * FROM sync_profiles WHERE provider = ? AND source_board_id = ? ORDER BY export_enabled DESC, created_at ASC LIMIT 1"
  ).get(provider, boardId) as {
    id: string;
    provider: string;
    name: string;
    entity_type: SyncEntityType;
    source_space_id: number | null;
    source_board_id: number | null;
    import_enabled: number;
    export_enabled: number;
    sync_interval_minutes: number;
    remote_wins_on_conflict: number;
    source_statuses: string;
    source_columns: string;
    source_lanes: string;
    available_development_stages: string;
    available_participants: string;
    last_catalog_synced_at: string | null;
    created_at: string;
    updated_at: string;
  } | undefined;
  return row ? mapSyncProfile(row) : undefined;
}

export function getKaitenSyncCatalog(): {
  development_stages: KaitenStageOption[];
  participants: DevelopmentParticipantInput[];
  profiles: Array<{
    profile_id: string;
    profile_name: string;
    board_id: number | null;
    development_stages: KaitenStageOption[];
    participants: DevelopmentParticipantInput[];
    last_catalog_synced_at: string | null;
  }>;
} {
  const profiles = getAllSyncProfiles("kaiten");
  const stagesMap = new Map<string, KaitenStageOption>();
  const participantsMap = new Map<string, DevelopmentParticipantInput>();

  for (const profile of profiles) {
    for (const stage of profile.available_development_stages) {
      stagesMap.set(stage.value, stage);
    }
    for (const participant of profile.available_participants) {
      const key = participant.remote_id ?? participant.name;
      participantsMap.set(key, participant);
    }
  }

  return {
    development_stages: Array.from(stagesMap.values()).sort((a, b) =>
      a.label.localeCompare(b.label, "ru")
    ),
    participants: Array.from(participantsMap.values()).sort((a, b) =>
      a.name.localeCompare(b.name, "ru")
    ),
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

export function upsertSyncOutboxJob(input: {
  provider: IntegrationProvider;
  profile_id?: string | null;
  local_entity_type: SyncEntityType;
  local_entity_id: string;
  remote_entity_type: string;
  remote_entity_id: string;
  next_attempt_at: string;
  last_error?: string | null;
}): SyncOutboxJob {
  const db = getDb();
  const now = new Date().toISOString();
  const existing = db.prepare(
    "SELECT * FROM sync_outbox WHERE provider = ? AND local_entity_type = ? AND local_entity_id = ?"
  ).get(input.provider, input.local_entity_type, input.local_entity_id) as {
    id: string;
    created_at: string;
  } | undefined;

  const id = existing?.id ?? crypto.randomUUID();
  const createdAt = existing?.created_at ?? now;

  db.prepare(`
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
    id,
    input.provider,
    input.profile_id ?? null,
    input.local_entity_type,
    input.local_entity_id,
    input.remote_entity_type,
    input.remote_entity_id,
    now,
    input.next_attempt_at,
    input.last_error ?? null,
    createdAt,
    now
  );

  return getSyncOutboxJobByLocal(input.provider, input.local_entity_type, input.local_entity_id)!;
}

export function getSyncOutboxJobByLocal(provider: IntegrationProvider, localEntityType: SyncEntityType, localEntityId: string): SyncOutboxJob | undefined {
  const db = getDb();
  const row = db.prepare(
    "SELECT * FROM sync_outbox WHERE provider = ? AND local_entity_type = ? AND local_entity_id = ?"
  ).get(provider, localEntityType, localEntityId) as {
    id: string;
    provider: string;
    profile_id: string | null;
    local_entity_type: SyncEntityType;
    local_entity_id: string;
    remote_entity_type: string;
    remote_entity_id: string;
    status: SyncOutboxStatus;
    attempts: number;
    requested_at: string;
    next_attempt_at: string;
    last_error: string | null;
    created_at: string;
    updated_at: string;
  } | undefined;
  return row ? {
    id: row.id,
    provider: row.provider as IntegrationProvider,
    profile_id: row.profile_id,
    local_entity_type: row.local_entity_type,
    local_entity_id: row.local_entity_id,
    remote_entity_type: row.remote_entity_type,
    remote_entity_id: row.remote_entity_id,
    status: row.status,
    attempts: row.attempts,
    requested_at: row.requested_at,
    next_attempt_at: row.next_attempt_at,
    last_error: row.last_error,
    created_at: row.created_at,
    updated_at: row.updated_at,
  } : undefined;
}

export function getDueSyncOutboxJobs(
  provider: IntegrationProvider,
  limit = 50,
  includeFuture = false
): SyncOutboxJob[] {
  const db = getDb();
  const rows = includeFuture
    ? db.prepare(`
        SELECT * FROM sync_outbox
        WHERE provider = ? AND status IN ('pending', 'error')
        ORDER BY requested_at ASC
        LIMIT ?
      `).all(provider, limit)
    : db.prepare(`
        SELECT * FROM sync_outbox
        WHERE provider = ? AND status IN ('pending', 'error') AND next_attempt_at <= ?
        ORDER BY next_attempt_at ASC
        LIMIT ?
      `).all(provider, new Date().toISOString(), limit) as {
    id: string;
    provider: string;
    profile_id: string | null;
    local_entity_type: SyncEntityType;
    local_entity_id: string;
    remote_entity_type: string;
    remote_entity_id: string;
    status: SyncOutboxStatus;
    attempts: number;
    requested_at: string;
    next_attempt_at: string;
    last_error: string | null;
    created_at: string;
    updated_at: string;
  }[];
  const typedRows = rows as {
    id: string;
    provider: string;
    profile_id: string | null;
    local_entity_type: SyncEntityType;
    local_entity_id: string;
    remote_entity_type: string;
    remote_entity_id: string;
    status: SyncOutboxStatus;
    attempts: number;
    requested_at: string;
    next_attempt_at: string;
    last_error: string | null;
    created_at: string;
    updated_at: string;
  }[];
  return typedRows.map((row) => ({
    id: row.id,
    provider: row.provider as IntegrationProvider,
    profile_id: row.profile_id,
    local_entity_type: row.local_entity_type,
    local_entity_id: row.local_entity_id,
    remote_entity_type: row.remote_entity_type,
    remote_entity_id: row.remote_entity_id,
    status: row.status,
    attempts: row.attempts,
    requested_at: row.requested_at,
    next_attempt_at: row.next_attempt_at,
    last_error: row.last_error,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }));
}

export function markSyncOutboxProcessing(id: string) {
  const db = getDb();
  db.prepare("UPDATE sync_outbox SET status = 'processing', attempts = attempts + 1, updated_at = ? WHERE id = ?").run(new Date().toISOString(), id);
}

export function markSyncOutboxError(id: string, nextAttemptAt: string, lastError: string) {
  const db = getDb();
  db.prepare("UPDATE sync_outbox SET status = 'error', next_attempt_at = ?, last_error = ?, updated_at = ? WHERE id = ?").run(nextAttemptAt, lastError, new Date().toISOString(), id);
}

export function deleteSyncOutboxJob(id: string) {
  const db = getDb();
  db.prepare("DELETE FROM sync_outbox WHERE id = ?").run(id);
}

// ======================== Staging ========================

export function getAllStagingItems(status?: StagingStatus): StagingItem[] {
  const db = getDb();
  if (status) {
    return db.prepare("SELECT * FROM staging_items WHERE staging_status = ? ORDER BY created_at DESC").all(status) as StagingItem[];
  }
  return db.prepare("SELECT * FROM staging_items ORDER BY created_at DESC").all() as StagingItem[];
}

export function getStagingItemById(id: string): StagingItem | undefined {
  const db = getDb();
  return db.prepare("SELECT * FROM staging_items WHERE id = ?").get(id) as StagingItem | undefined;
}

export function createStagingItem(item: {
  id: string;
  entity_type: StagingEntityType;
  title: string;
  description: string;
  parsed_data: string;
  batch_id: string;
}): StagingItem {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO staging_items (id, entity_type, title, description, parsed_data, staging_status, batch_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?)
  `).run(item.id, item.entity_type, item.title, item.description, item.parsed_data, item.batch_id, now, now);
  return db.prepare("SELECT * FROM staging_items WHERE id = ?").get(item.id) as StagingItem;
}

export function updateStagingItem(id: string, updates: Partial<Pick<StagingItem, "title" | "description" | "parsed_data" | "staging_status" | "entity_type" | "batch_id">>): StagingItem | undefined {
  const db = getDb();
  const fields: string[] = [];
  const values: unknown[] = [];
  for (const [key, value] of Object.entries(updates)) {
    if (value !== undefined) {
      fields.push(`${key} = ?`);
      values.push(value);
    }
  }
  if (fields.length === 0) return getStagingItemById(id);
  const now = new Date().toISOString();
  fields.push("updated_at = ?");
  values.push(now, id);
  db.prepare(`UPDATE staging_items SET ${fields.join(", ")} WHERE id = ?`).run(...values);
  return getStagingItemById(id);
}

export function deleteStagingItem(id: string): boolean {
  const db = getDb();
  return db.prepare("DELETE FROM staging_items WHERE id = ?").run(id).changes > 0;
}

export function deleteStagingBatch(batchId: string): boolean {
  const db = getDb();
  return db.prepare("DELETE FROM staging_items WHERE batch_id = ?").run(batchId).changes > 0;
}

export function approveStagingItem(id: string): StagingItem | undefined {
  return updateStagingItem(id, { staging_status: "approved" });
}

export function rejectStagingItem(id: string): StagingItem | undefined {
  return updateStagingItem(id, { staging_status: "rejected" });
}
