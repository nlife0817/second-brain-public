"use client";

// Участники для @-упоминаний. Отдаётся функцией, а не массивом: набор
// расширений редактора собирается внутри useEditor, и зависимость от состава
// участников заставляла бы пересоздавать редактор на каждый refreshMembers() —
// вместе с историей правок и позицией курсора. Тот же приём, что у uploadFiles
// в useDocEditor.

import { useCallback } from "react";
import { useV2StoreApi } from "@/lib/core/ui-store";
import type { MentionItem } from "./MentionList";

export function useMentionItems(): () => MentionItem[] {
  const storeApi = useV2StoreApi();
  return useCallback(
    () =>
      storeApi.getState().members.map((m) => ({
        id: m.user_id,
        label: m.name || m.email,
        email: m.email,
        avatar_url: m.avatar_url,
      })),
    [storeApi],
  );
}
