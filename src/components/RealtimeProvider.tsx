"use client";

import { useEffect } from "react";
import { useBrainStore } from "@/lib/store";
import { subscribeToRealtime } from "@/lib/realtime";

export function RealtimeProvider() {
  const fetchItems = useBrainStore((s) => s.fetchItems);
  const fetchTags = useBrainStore((s) => s.fetchTags);
  const fetchCategories = useBrainStore((s) => s.fetchCategories);
  const fetchClients = useBrainStore((s) => ("fetchClients" in s ? (s as unknown as { fetchClients: () => Promise<void> }).fetchClients : undefined));
  const fetchClientStatuses = useBrainStore((s) => ("fetchClientStatuses" in s ? (s as unknown as { fetchClientStatuses: () => Promise<void> }).fetchClientStatuses : undefined));
  const fetchStaging = useBrainStore((s) => ("fetchStaging" in s ? (s as unknown as { fetchStaging: () => Promise<void> }).fetchStaging : undefined));

  useEffect(() => {
    const unsubscribe = subscribeToRealtime({
      fetchItems,
      fetchTags,
      fetchCategories,
      fetchClients,
      fetchClientStatuses,
      fetchStaging,
    });
    return unsubscribe;
  }, [fetchItems, fetchTags, fetchCategories, fetchClients, fetchClientStatuses, fetchStaging]);

  return null;
}
