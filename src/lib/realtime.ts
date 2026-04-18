"use client";

import type { RealtimeChannel } from "@supabase/supabase-js";
import { createSupabaseBrowserClient } from "./supabase/client";

type RefetchBundle = {
  fetchItems?: () => Promise<void>;
  fetchTags?: () => Promise<void>;
  fetchCategories?: () => Promise<void>;
  fetchClients?: () => Promise<void>;
  fetchClientStatuses?: () => Promise<void>;
  fetchRelationTypes?: () => Promise<void>;
  fetchStaging?: () => Promise<void>;
  fetchComments?: (entityType: "item" | "client", entityId: string) => Promise<void>;
};

let channel: RealtimeChannel | null = null;

/**
 * Subscribe to Postgres changes across the main tables. Each incoming event
 * simply triggers the corresponding refetch in the Zustand store — good enough
 * for a single-user/few-user app and avoids fragile per-row merging logic.
 *
 * Deduplication: we debounce each fetcher by 150 ms so a burst of events
 * (e.g. bulk insert) collapses into one refetch.
 */
export function subscribeToRealtime(bundle: RefetchBundle): () => void {
  if (channel) return () => {};
  const supabase = createSupabaseBrowserClient();

  const debounced = new Map<string, ReturnType<typeof setTimeout>>();
  function schedule(key: string, fn?: () => Promise<void>) {
    if (!fn) return;
    const existing = debounced.get(key);
    if (existing) clearTimeout(existing);
    debounced.set(
      key,
      setTimeout(() => {
        debounced.delete(key);
        fn().catch((e) => console.error(`[realtime] refetch ${key}:`, e));
      }, 150)
    );
  }

  const ch: RealtimeChannel = supabase.channel("db-changes");
  channel = ch;

  const ITEM_TABLES = [
    "items", "item_tags", "item_development_participants",
    "development_participants", "development_stages",
    "weekly_plans", "weekly_plan_entries", "entry_comments",
    "staging_items",
  ];
  const TAG_TABLES = ["tags"];
  const CATEGORY_TABLES = ["categories"];
  const CLIENT_TABLES = [
    "clients", "client_companies", "client_contacts", "client_contact_fields",
    "client_notes", "client_links", "client_crm_systems", "crm_systems",
  ];
  const CLIENT_STATUS_TABLES = ["client_statuses"];
  const RELATION_TABLES = ["relation_types", "relations"];
  const COMMENT_TABLES = ["comments"];

  const bind = (tables: string[], handler: () => void) => {
    for (const t of tables) {
      ch.on(
        "postgres_changes" as never,
        { event: "*", schema: "public", table: t },
        handler as never
      );
    }
  };

  bind(ITEM_TABLES, () => schedule("items", bundle.fetchItems));
  bind(TAG_TABLES, () => schedule("tags", bundle.fetchTags));
  bind(CATEGORY_TABLES, () => schedule("categories", bundle.fetchCategories));
  bind(CLIENT_TABLES, () => schedule("clients", bundle.fetchClients));
  bind(CLIENT_STATUS_TABLES, () => schedule("client_statuses", bundle.fetchClientStatuses));
  bind(RELATION_TABLES, () => schedule("items_relations", bundle.fetchItems));
  bind(COMMENT_TABLES, () => schedule("items_comments", bundle.fetchItems));

  ch.subscribe();

  return () => {
    for (const [, t] of debounced) clearTimeout(t);
    debounced.clear();
    channel?.unsubscribe();
    channel = null;
  };
}
