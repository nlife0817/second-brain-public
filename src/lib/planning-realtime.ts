"use client";

import type { RealtimeChannel } from "@supabase/supabase-js";
import { createSupabaseBrowserClient } from "./supabase/client";
import { usePlanningStore } from "./planning-store";

let channel: RealtimeChannel | null = null;

/**
 * Subscribe to planning_* changes and refetch the store on any event (debounced).
 * Returns an unsubscribe function. Idempotent — repeat calls reuse the channel.
 *
 * Concept §20.4: realtime only for the active screen.
 */
export function subscribePlanningRealtime(): () => void {
  if (channel) return () => {};
  const supabase = createSupabaseBrowserClient();
  const ch = supabase.channel("planning-changes");
  channel = ch;

  let refetchTimer: ReturnType<typeof setTimeout> | null = null;
  const schedule = () => {
    if (refetchTimer) clearTimeout(refetchTimer);
    refetchTimer = setTimeout(() => {
      void usePlanningStore.getState().fetchAll();
    }, 250);
  };

  const tables = [
    "planning_directions",
    "planning_periods",
    "planning_metrics",
    "planning_metric_targets",
    "planning_metric_ticks",
    "planning_initiatives",
    "planning_initiative_metric_link",
    "planning_initiative_deal_link",
    "planning_initiative_client_link",
    "planning_initiative_dependency",
    "planning_period_initiative_link",
    "planning_deals",
    "planning_deal_payments",
    "planning_change_log",
    "planning_settings",
    "planning_icp_segments",
  ];
  for (const t of tables) {
    ch.on("postgres_changes" as never, { event: "*", schema: "public", table: t }, schedule);
  }
  ch.subscribe();

  return () => {
    if (refetchTimer) clearTimeout(refetchTimer);
    channel?.unsubscribe();
    channel = null;
  };
}
