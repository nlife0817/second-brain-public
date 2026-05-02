"use client";

import type { RealtimeChannel } from "@supabase/supabase-js";
import { createSupabaseBrowserClient } from "./supabase/client";
import { useBrainStore } from "./store";

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
 * Subscribe to Postgres changes and merge them into local state row-by-row.
 *
 * The previous implementation fired a full `fetchItems()` on every event,
 * which replaced the entire `items` array, unmounted any open inline editor
 * and made the screen flicker on every edit. Now:
 *
 *   - `items` UPDATE → mergeRemoteItem(payload.new) — patches only changed
 *     scalar fields, skips fields with an in-flight local mutation or with
 *     an open inline editor (so the user's pending edit isn't clobbered).
 *     Echoes of our own writes are detected via `updated_at` and skipped.
 *   - `items` INSERT/DELETE → targeted insert/remove.
 *   - Join tables that affect a single item (`item_tags`,
 *     `item_development_participants`) → debounced `fetchItem(id)` per item;
 *     this re-reads only the affected row with its joins, leaving every
 *     other row's DOM untouched.
 *   - Catalog tables (`tags`, `categories`, `clients`, `client_statuses`)
 *     → debounced full refetch of the catalog (their volume is small and
 *     they don't drive the items list re-render).
 *
 * For tables that don't directly affect the items list (weekly plans,
 * staging items, comments, relations) we keep their existing full-refetch
 * fallback under separate debounce keys; they fire rarely.
 */
export function subscribeToRealtime(bundle: RefetchBundle): () => void {
  if (channel) return () => {};
  const supabase = createSupabaseBrowserClient();

  // Per-key debounce so a burst of events for the same target collapses
  // into one action.
  const debounced = new Map<string, ReturnType<typeof setTimeout>>();
  function schedule(key: string, fn: () => void | Promise<void>, delay = 150) {
    const existing = debounced.get(key);
    if (existing) clearTimeout(existing);
    debounced.set(
      key,
      setTimeout(() => {
        debounced.delete(key);
        try {
          const r = fn();
          if (r && typeof (r as Promise<void>).catch === "function") {
            (r as Promise<void>).catch((e) =>
              console.error(`[realtime] ${key}:`, e)
            );
          }
        } catch (e) {
          console.error(`[realtime] ${key}:`, e);
        }
      }, delay)
    );
  }

  type ItemRow = {
    id: string;
    updated_at?: string;
    [k: string]: unknown;
  };
  type Payload = {
    eventType: "INSERT" | "UPDATE" | "DELETE";
    new: ItemRow | null;
    old: ItemRow | null;
    table: string;
  };

  const ch: RealtimeChannel = supabase.channel("db-changes");
  channel = ch;

  /* ---- items: row-level merge ------------------------------------------ */
  ch.on(
    "postgres_changes" as never,
    { event: "*", schema: "public", table: "items" },
    ((payload: Payload) => {
      const store = useBrainStore.getState();
      const evt = payload.eventType;
      if (evt === "DELETE") {
        const id = payload.old?.id;
        if (id) store.applyRemoteDelete(id);
        return;
      }
      if (evt === "INSERT") {
        const id = payload.new?.id;
        if (!id) return;
        // Coalesce bursty inserts on the same id (e.g. INSERT followed by
        // immediate UPDATE) into a single fetchItem.
        schedule(`item:${id}`, () => store.fetchItem(id));
        return;
      }
      if (evt === "UPDATE") {
        const row = payload.new;
        if (!row?.id) return;
        store.mergeRemoteItem(row);
      }
    }) as never
  );

  /* ---- item join tables: targeted refetch of the affected item --------- */
  const ITEM_JOIN_TABLES = [
    "item_tags",
    "item_development_participants",
  ];
  for (const table of ITEM_JOIN_TABLES) {
    ch.on(
      "postgres_changes" as never,
      { event: "*", schema: "public", table },
      ((payload: Payload) => {
        const itemId =
          (payload.new as Record<string, unknown> | null)?.item_id ??
          (payload.old as Record<string, unknown> | null)?.item_id;
        if (typeof itemId !== "string") return;
        schedule(`item:${itemId}`, () =>
          useBrainStore.getState().fetchItem(itemId)
        );
      }) as never
    );
  }

  /* ---- catalog tables: small, can be fully refetched ------------------- */
  const bind = (table: string, key: string, fn?: () => Promise<void>) => {
    if (!fn) return;
    ch.on(
      "postgres_changes" as never,
      { event: "*", schema: "public", table },
      (() => schedule(key, fn)) as never
    );
  };

  bind("tags", "tags", bundle.fetchTags);
  bind("categories", "categories", bundle.fetchCategories);

  // Clients group — keep existing behaviour, they're a separate view.
  for (const t of [
    "clients", "client_companies", "client_contacts", "client_contact_fields",
    "client_notes", "client_links", "client_crm_systems", "crm_systems",
  ]) {
    bind(t, "clients", bundle.fetchClients);
  }
  bind("client_statuses", "client_statuses", bundle.fetchClientStatuses);

  // Staging — separate view, full refetch is fine.
  bind("staging_items", "staging", bundle.fetchStaging);

  // Weekly plans, comments, relations — they don't drive the items list
  // re-render directly. We intentionally don't refetch the items list for
  // these; per-page hooks handle their own data.

  ch.subscribe();

  return () => {
    for (const [, t] of debounced) clearTimeout(t);
    debounced.clear();
    channel?.unsubscribe();
    channel = null;
  };
}
