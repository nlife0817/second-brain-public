-- Initial schema: port of src/lib/db.ts initSchema() + migrateSchema() to Postgres.
-- All text ids (UUID-like strings) preserved to match existing code.

-- ----------------------------------------------------------------------------
-- Helper: reproduce SQLite datetime('now') format ('YYYY-MM-DD HH:MM:SS' UTC)
-- so existing TypeScript code that compares/serializes timestamps as strings
-- keeps working without changes.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sqlite_now()
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS');
$$;

-- ----------------------------------------------------------------------------
-- Categories
-- ----------------------------------------------------------------------------
CREATE TABLE public.categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#6b7280',
  icon TEXT NOT NULL DEFAULT 'Folder',
  position INTEGER NOT NULL DEFAULT 0
);

-- ----------------------------------------------------------------------------
-- Items (main content: tasks, notes, meetings, plans, ideas)
-- ----------------------------------------------------------------------------
CREATE TABLE public.items (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  type TEXT NOT NULL DEFAULT 'task' CHECK (type IN ('task','note','meeting','plan','idea')),
  status TEXT NOT NULL DEFAULT 'inbox' CHECK (status IN ('inbox','todo','in_progress','review','done','archived')),
  priority TEXT NOT NULL DEFAULT 'none' CHECK (priority IN ('urgent','high','medium','low','none')),
  category TEXT NOT NULL DEFAULT 'other',
  source TEXT NOT NULL DEFAULT 'system',
  development_stage TEXT,
  due_date TEXT,
  position INTEGER NOT NULL DEFAULT 0,
  parent_id TEXT REFERENCES public.items(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT sqlite_now(),
  updated_at TEXT NOT NULL DEFAULT sqlite_now()
);

CREATE INDEX idx_items_status ON public.items(status);
CREATE INDEX idx_items_category ON public.items(category);
CREATE INDEX idx_items_parent ON public.items(parent_id);
CREATE INDEX idx_items_priority ON public.items(priority);
CREATE INDEX idx_items_development_stage ON public.items(development_stage);
CREATE INDEX idx_items_position ON public.items(position);
CREATE INDEX idx_items_status_parent ON public.items(status, parent_id);
CREATE INDEX idx_items_source ON public.items(source);
CREATE INDEX idx_items_type ON public.items(type);
CREATE INDEX idx_items_due_date ON public.items(due_date);
CREATE INDEX idx_items_created_at ON public.items(created_at DESC);

-- ----------------------------------------------------------------------------
-- Tags
-- ----------------------------------------------------------------------------
CREATE TABLE public.tags (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  color TEXT NOT NULL DEFAULT '#6b7280',
  position INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE public.item_tags (
  item_id TEXT NOT NULL REFERENCES public.items(id) ON DELETE CASCADE,
  tag_id TEXT NOT NULL REFERENCES public.tags(id) ON DELETE CASCADE,
  PRIMARY KEY (item_id, tag_id)
);

CREATE INDEX idx_item_tags_tag ON public.item_tags(tag_id);

-- ----------------------------------------------------------------------------
-- Development stages + participants
-- ----------------------------------------------------------------------------
CREATE TABLE public.development_stages (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE public.development_participants (
  id TEXT PRIMARY KEY,
  provider TEXT,
  remote_id TEXT,
  name TEXT NOT NULL DEFAULT '',
  position INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT sqlite_now(),
  updated_at TEXT NOT NULL DEFAULT sqlite_now(),
  UNIQUE (provider, remote_id)
);

CREATE TABLE public.item_development_participants (
  item_id TEXT NOT NULL REFERENCES public.items(id) ON DELETE CASCADE,
  participant_id TEXT NOT NULL REFERENCES public.development_participants(id) ON DELETE CASCADE,
  PRIMARY KEY (item_id, participant_id)
);

CREATE INDEX idx_item_development_participants_item ON public.item_development_participants(item_id);
CREATE INDEX idx_item_dev_participants_participant ON public.item_development_participants(participant_id);

-- ----------------------------------------------------------------------------
-- Weekly plans
-- ----------------------------------------------------------------------------
CREATE TABLE public.weekly_plans (
  id TEXT PRIMARY KEY,
  week_start TEXT NOT NULL,
  week_end TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','completed','archived')),
  created_at TEXT NOT NULL DEFAULT sqlite_now(),
  updated_at TEXT NOT NULL DEFAULT sqlite_now()
);

CREATE TABLE public.weekly_plan_entries (
  id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL REFERENCES public.weekly_plans(id) ON DELETE CASCADE,
  item_id TEXT NOT NULL REFERENCES public.items(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0,
  result_status TEXT NOT NULL DEFAULT 'pending' CHECK (result_status IN ('pending','done','not_done','transferred')),
  result_comment TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT sqlite_now(),
  updated_at TEXT NOT NULL DEFAULT sqlite_now(),
  UNIQUE (plan_id, item_id)
);

CREATE TABLE public.entry_comments (
  id TEXT PRIMARY KEY,
  entry_id TEXT NOT NULL REFERENCES public.weekly_plan_entries(id) ON DELETE CASCADE,
  text TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT sqlite_now()
);

CREATE INDEX idx_wp_status ON public.weekly_plans(status);
CREATE INDEX idx_wp_week ON public.weekly_plans(week_start);
CREATE INDEX idx_wpe_plan ON public.weekly_plan_entries(plan_id);
CREATE INDEX idx_wpe_item ON public.weekly_plan_entries(item_id);
CREATE INDEX idx_ec_entry ON public.entry_comments(entry_id);

-- ----------------------------------------------------------------------------
-- Clients / CRM
-- ----------------------------------------------------------------------------
CREATE TABLE public.client_statuses (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#6b7280',
  position INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE public.clients (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  status_id TEXT REFERENCES public.client_statuses(id) ON DELETE SET NULL,
  budget TEXT NOT NULL DEFAULT '',
  operators_per_shift TEXT NOT NULL DEFAULT '',
  operators_total TEXT NOT NULL DEFAULT '',
  calls_per_month TEXT NOT NULL DEFAULT '',
  crm_system TEXT NOT NULL DEFAULT '',
  position INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT sqlite_now(),
  updated_at TEXT NOT NULL DEFAULT sqlite_now()
);

CREATE TABLE public.client_companies (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT ''
);

CREATE TABLE public.client_contacts (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT '',
  position INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE public.client_contact_fields (
  id TEXT PRIMARY KEY,
  contact_id TEXT NOT NULL REFERENCES public.client_contacts(id) ON DELETE CASCADE,
  type TEXT NOT NULL DEFAULT 'email' CHECK (type IN ('email','phone','telegram','note')),
  value TEXT NOT NULL DEFAULT ''
);

CREATE TABLE public.client_notes (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  text TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT sqlite_now()
);

CREATE TABLE public.client_links (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  url TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL DEFAULT ''
);

CREATE INDEX idx_clients_status ON public.clients(status_id);
CREATE INDEX idx_clients_position ON public.clients(position);
CREATE INDEX idx_clients_created_at ON public.clients(created_at DESC);
CREATE INDEX idx_cc_client ON public.client_companies(client_id);
CREATE INDEX idx_ccon_client ON public.client_contacts(client_id);
CREATE INDEX idx_ccf_contact ON public.client_contact_fields(contact_id);
CREATE INDEX idx_cn_client ON public.client_notes(client_id);
CREATE INDEX idx_cl_client ON public.client_links(client_id);

-- ----------------------------------------------------------------------------
-- CRM systems (many-to-many with clients)
-- ----------------------------------------------------------------------------
CREATE TABLE public.crm_systems (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE public.client_crm_systems (
  client_id TEXT NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  crm_system_id TEXT NOT NULL REFERENCES public.crm_systems(id) ON DELETE CASCADE,
  PRIMARY KEY (client_id, crm_system_id)
);

CREATE INDEX idx_ccs_client ON public.client_crm_systems(client_id);
CREATE INDEX idx_client_crm_systems_crm ON public.client_crm_systems(crm_system_id);

-- ----------------------------------------------------------------------------
-- Relation types + relations (polymorphic: item <-> item, item <-> client, client <-> client)
-- ----------------------------------------------------------------------------
CREATE TABLE public.relation_types (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#6b7280',
  icon TEXT NOT NULL DEFAULT 'Link',
  position INTEGER NOT NULL DEFAULT 0,
  is_system INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE public.relations (
  id TEXT PRIMARY KEY,
  source_type TEXT NOT NULL CHECK (source_type IN ('item','client')),
  source_id TEXT NOT NULL,
  target_type TEXT NOT NULL CHECK (target_type IN ('item','client')),
  target_id TEXT NOT NULL,
  relation_type_id TEXT REFERENCES public.relation_types(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT sqlite_now(),
  UNIQUE (source_type, source_id, target_type, target_id)
);

CREATE INDEX idx_rel_source ON public.relations(source_type, source_id);
CREATE INDEX idx_rel_target ON public.relations(target_type, target_id);
CREATE INDEX idx_rel_type ON public.relations(relation_type_id);

-- ----------------------------------------------------------------------------
-- Comments (polymorphic: item or client)
-- ----------------------------------------------------------------------------
CREATE TABLE public.comments (
  id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('item','client')),
  entity_id TEXT NOT NULL,
  text TEXT NOT NULL DEFAULT '',
  author_email TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT sqlite_now(),
  updated_at TEXT NOT NULL DEFAULT sqlite_now()
);

CREATE INDEX idx_comments_entity ON public.comments(entity_type, entity_id);
CREATE INDEX idx_comments_created_at ON public.comments(created_at DESC);

-- ----------------------------------------------------------------------------
-- Staging (approval queue for imported data)
-- ----------------------------------------------------------------------------
CREATE TABLE public.staging_items (
  id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL DEFAULT 'item' CHECK (entity_type IN ('item','client')),
  title TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  parsed_data TEXT NOT NULL DEFAULT '{}',
  staging_status TEXT NOT NULL DEFAULT 'pending' CHECK (staging_status IN ('pending','approved','rejected')),
  batch_id TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT sqlite_now(),
  updated_at TEXT NOT NULL DEFAULT sqlite_now()
);

CREATE INDEX idx_staging_status ON public.staging_items(staging_status);
CREATE INDEX idx_staging_batch ON public.staging_items(batch_id);
CREATE INDEX idx_staging_entity_type ON public.staging_items(entity_type);
CREATE INDEX idx_staging_updated_at ON public.staging_items(updated_at DESC);

-- ----------------------------------------------------------------------------
-- Users (app-level whitelist + role)
-- ----------------------------------------------------------------------------
CREATE TABLE public.users (
  email TEXT PRIMARY KEY,
  role TEXT NOT NULL DEFAULT 'admin' CHECK (role IN ('admin','manager')),
  name TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT sqlite_now(),
  updated_at TEXT NOT NULL DEFAULT sqlite_now()
);

-- ----------------------------------------------------------------------------
-- Integration settings + external sync (Kaiten, etc)
-- ----------------------------------------------------------------------------
CREATE TABLE public.integration_settings (
  provider TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL DEFAULT 0,
  company_domain TEXT NOT NULL DEFAULT '',
  api_base_url TEXT NOT NULL DEFAULT '',
  token_secret TEXT NOT NULL DEFAULT '',
  default_import_target TEXT NOT NULL DEFAULT 'staging' CHECK (default_import_target IN ('staging')),
  created_at TEXT NOT NULL DEFAULT sqlite_now(),
  updated_at TEXT NOT NULL DEFAULT sqlite_now()
);

CREATE TABLE public.sync_profiles (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  entity_type TEXT NOT NULL DEFAULT 'item' CHECK (entity_type IN ('item','client')),
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
  created_at TEXT NOT NULL DEFAULT sqlite_now(),
  updated_at TEXT NOT NULL DEFAULT sqlite_now()
);

CREATE INDEX idx_sync_profiles_provider ON public.sync_profiles(provider);

CREATE TABLE public.sync_field_mappings (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES public.sync_profiles(id) ON DELETE CASCADE,
  local_entity_type TEXT NOT NULL DEFAULT 'item' CHECK (local_entity_type IN ('item','client')),
  local_field TEXT NOT NULL,
  remote_field TEXT NOT NULL,
  direction TEXT NOT NULL DEFAULT 'import' CHECK (direction IN ('import','export','bidirectional')),
  transform_rule TEXT,
  created_at TEXT NOT NULL DEFAULT sqlite_now(),
  updated_at TEXT NOT NULL DEFAULT sqlite_now()
);

CREATE INDEX idx_sync_field_mappings_profile ON public.sync_field_mappings(profile_id);

CREATE TABLE public.external_entity_links (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  profile_id TEXT REFERENCES public.sync_profiles(id) ON DELETE SET NULL,
  local_entity_type TEXT NOT NULL CHECK (local_entity_type IN ('item','client')),
  local_entity_id TEXT NOT NULL,
  remote_entity_type TEXT NOT NULL DEFAULT 'card',
  remote_entity_id TEXT NOT NULL,
  remote_space_id INTEGER,
  remote_board_id INTEGER,
  remote_column_id INTEGER,
  remote_lane_id INTEGER,
  last_remote_updated_at TEXT,
  last_local_synced_at TEXT,
  sync_state TEXT NOT NULL DEFAULT 'pending' CHECK (sync_state IN ('active','pending','error','archived')),
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT sqlite_now(),
  updated_at TEXT NOT NULL DEFAULT sqlite_now(),
  UNIQUE (provider, remote_entity_type, remote_entity_id)
);

CREATE INDEX idx_external_links_local ON public.external_entity_links(local_entity_type, local_entity_id);
CREATE INDEX idx_external_links_provider ON public.external_entity_links(provider);
CREATE INDEX idx_external_links_profile ON public.external_entity_links(profile_id);

CREATE TABLE public.sync_import_runs (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  profile_id TEXT NOT NULL REFERENCES public.sync_profiles(id) ON DELETE CASCADE,
  batch_id TEXT NOT NULL,
  stats_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT sqlite_now()
);

CREATE INDEX idx_sync_import_runs_profile ON public.sync_import_runs(profile_id, created_at DESC);

CREATE TABLE public.sync_outbox (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  profile_id TEXT REFERENCES public.sync_profiles(id) ON DELETE SET NULL,
  local_entity_type TEXT NOT NULL CHECK (local_entity_type IN ('item','client')),
  local_entity_id TEXT NOT NULL,
  remote_entity_type TEXT NOT NULL DEFAULT 'card',
  remote_entity_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','error')),
  attempts INTEGER NOT NULL DEFAULT 0,
  requested_at TEXT NOT NULL DEFAULT sqlite_now(),
  next_attempt_at TEXT NOT NULL DEFAULT sqlite_now(),
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT sqlite_now(),
  updated_at TEXT NOT NULL DEFAULT sqlite_now(),
  UNIQUE (provider, local_entity_type, local_entity_id)
);

CREATE INDEX idx_sync_outbox_due ON public.sync_outbox(provider, status, next_attempt_at);
