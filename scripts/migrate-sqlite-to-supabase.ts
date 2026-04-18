/**
 * One-shot data migration from local SQLite (data/brain.db) to Supabase Postgres.
 *
 * Usage: npx tsx scripts/migrate-sqlite-to-supabase.ts
 *
 * Requires DATABASE_URL in .env.local (Direct connection string, not pooler).
 */
import dotenv from "dotenv";
import Database from "better-sqlite3";
import postgres from "postgres";
import path from "path";

dotenv.config({ path: path.join(process.cwd(), ".env.local") });
dotenv.config();

const SQLITE_PATH = path.join(process.cwd(), "data", "brain.db");
// Prefer Transaction pooler (IPv4) over Direct (often IPv6-only from Windows).
const DATABASE_URL = process.env.DATABASE_POOL_URL || process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error("DATABASE_POOL_URL (or DATABASE_URL) is not set in .env.local");
  process.exit(1);
}

// Tables in FK-safe insertion order.
const TABLES_ORDER = [
  "users",
  "categories",
  "tags",
  "client_statuses",
  "crm_systems",
  "development_stages",
  "development_participants",
  "integration_settings",
  "sync_profiles",
  "relation_types",
  "clients",
  "client_companies",
  "client_contacts",
  "client_contact_fields",
  "client_notes",
  "client_links",
  "client_crm_systems",
  "items",
  "item_tags",
  "item_development_participants",
  "weekly_plans",
  "weekly_plan_entries",
  "entry_comments",
  "relations",
  "comments",
  "staging_items",
  "sync_field_mappings",
  "external_entity_links",
  "sync_import_runs",
  "sync_outbox",
];

async function main() {
  console.log(`Opening SQLite at ${SQLITE_PATH}…`);
  const sqlite = new Database(SQLITE_PATH, { readonly: true });
  sqlite.pragma("foreign_keys = OFF");

  console.log("Connecting to Postgres…");
  const sql = postgres(DATABASE_URL!, {
    prepare: false,
    max: 1,
    ssl: "require",
    connect_timeout: 15,
  });

  try {
    for (const table of TABLES_ORDER) {
      // Ensure source table exists in SQLite (older DBs may not have everything).
      const exists = sqlite.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name=?"
      ).get(table) as { name: string } | undefined;
      if (!exists) {
        console.log(`· skip ${table} (not in SQLite)`);
        continue;
      }

      const rows = sqlite.prepare(`SELECT * FROM ${table}`).all() as Record<string, unknown>[];
      if (rows.length === 0) {
        console.log(`· ${table}: 0 rows`);
        continue;
      }

      // Detect target columns from first row.
      const cols = Object.keys(rows[0]);
      const placeholders = cols.map((_, i) => `$${i + 1}`).join(", ");
      const updates = cols
        .filter((c) => c !== "id" && c !== "email" && c !== "provider")
        .map((c) => `"${c}" = EXCLUDED."${c}"`)
        .join(", ");

      // Conflict target depends on table primary key structure.
      let conflict = "";
      if (table === "users" || table === "integration_settings") {
        conflict = table === "users"
          ? "ON CONFLICT (email) DO NOTHING"
          : "ON CONFLICT (provider) DO NOTHING";
      } else if (
        table === "item_tags" ||
        table === "item_development_participants" ||
        table === "client_crm_systems"
      ) {
        conflict = "ON CONFLICT DO NOTHING";
      } else if (cols.includes("id")) {
        conflict = updates
          ? `ON CONFLICT (id) DO UPDATE SET ${updates}`
          : "ON CONFLICT (id) DO NOTHING";
      } else {
        conflict = "ON CONFLICT DO NOTHING";
      }

      const colList = cols.map((c) => `"${c}"`).join(", ");
      const query = `INSERT INTO public."${table}" (${colList}) VALUES (${placeholders}) ${conflict}`;

      let inserted = 0;
      for (const row of rows) {
        const values = cols.map((c) => {
          const v = row[c];
          // SQLite stores booleans as 0/1 integers — Postgres keeps them as INTEGER in our schema.
          return v;
        });
        try {
          await sql.unsafe(query, values as never[]);
          inserted++;
        } catch (e) {
          console.error(`  ! error on ${table} row:`, (row as { id?: unknown }).id ?? row, e instanceof Error ? e.message : e);
        }
      }
      console.log(`· ${table}: ${inserted}/${rows.length} rows`);
    }

    console.log("\nDone ✓");
  } finally {
    sqlite.close();
    await sql.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
