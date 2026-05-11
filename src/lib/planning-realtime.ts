"use client";

import type { RealtimeChannel } from "@supabase/supabase-js";
import { createSupabaseBrowserClient } from "./supabase/client";
import { usePlanningStore } from "./planning-store";

let channel: RealtimeChannel | null = null;

// Время последней локальной мутации (любой PATCH/POST/DELETE из UI планирования).
// Используется как гейт для realtime: пока пользователь активно редактирует —
// откладываем массовый fetchAll, иначе на каждый keystroke (через debounce
// InlineTextField) прилетал бы полный refetch и UI лагал.
let lastLocalMutation = 0;

/**
 * Зафиксировать, что мы только что сделали локальную мутацию planning-* данных.
 * Подавляет realtime echo на короткое окно, чтобы избежать двойного refetch
 * (свой PATCH → supabase echo → fetchAll → optimistic state перетирается).
 */
export function markLocalMutation(): void {
  lastLocalMutation = Date.now();
}

// Базовый debounce — даём время на batch-edit'ы (typing flurries).
const BASE_DEBOUNCE_MS = 600;
// Окно подавления: если локальная мутация случилась < этого назад,
// откладываем refetch до конца окна + небольшой запас.
const LOCAL_SUPPRESS_MS = 1500;

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
    const sinceLocal = Date.now() - lastLocalMutation;
    // Если только что сами писали — ждём больше; иначе базовый debounce.
    const delay = sinceLocal < LOCAL_SUPPRESS_MS
      ? LOCAL_SUPPRESS_MS - sinceLocal + 200
      : BASE_DEBOUNCE_MS;
    refetchTimer = setTimeout(() => {
      void usePlanningStore.getState().fetchAll();
    }, delay);
  };

  const tables = [
    "planning_directions",
    "planning_periods",
    "planning_metrics",
    "planning_metric_targets",
    "planning_metric_ticks",
    "planning_initiatives",
    "planning_initiative_metric_link",
    "planning_initiative_client_block", // P8 (бывш. planning_initiative_deal_link)
    "planning_initiative_client_link",
    "planning_period_initiative_link",
    "client_deals",                      // P8 (бывш. planning_deals)
    "client_deal_payments",              // P8 (бывш. planning_deal_payments)
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
