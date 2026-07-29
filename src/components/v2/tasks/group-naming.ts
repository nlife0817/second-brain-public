"use client";

// Подписи и порядок групп: как называется группа «в работе» и в каком порядке
// группы идут. Живёт отдельно от таблицы, потому что гант группирует строки той
// же настройкой представления — своя копия этих правил означала бы, что одна и
// та же группировка даёт в таблице и на ганте разные названия и разный порядок.

import { useCallback, useMemo } from "react";
import { PRIORITY_LABELS } from "@/components/v2/bits";
import type { TaskPriority } from "@/lib/core/types";
import { useV2Store } from "@/lib/core/ui-store";
import {
  DUE_BUCKETS,
  ESTIMATE_BUCKETS,
  NONE_VALUE,
  PRIORITY_WEIGHT,
  type GroupByField,
  type GroupLabel,
  type GroupNaming,
} from "@/lib/core/views";

/** Как называется группа «ничего не выбрано» у каждого поля. */
const EMPTY_LABELS: Record<string, string> = {
  status: "Без статуса",
  project: "Без проекта",
  assignee: "Без исполнителя",
  tag: "Без тегов",
  due: "Без срока",
  estimate: "Без оценки",
};

/** Ранг неизвестного ключа: в конец, но выше «пусто». */
const UNKNOWN_RANK = 9998;

export function useGroupNaming(): GroupNaming {
  const { statuses, tags, members, projects } = useV2Store();
  const projectsById = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects]);

  const labelForGroup = useCallback(
    (field: GroupByField, key: string): GroupLabel => {
      if (key === NONE_VALUE) return { text: EMPTY_LABELS[field] ?? "Прочее" };
      switch (field) {
        case "status": {
          const s = statuses.find((x) => x.id === key);
          return { text: s?.name ?? "Неизвестный статус", color: s?.color };
        }
        case "priority":
          return { text: PRIORITY_LABELS[key as TaskPriority]?.label ?? key };
        case "project": {
          const p = projectsById.get(key);
          return { text: p?.name ?? "Недоступный проект", color: p?.color };
        }
        case "assignee": {
          const m = members.find((x) => x.user_id === key);
          return { text: m ? m.name || m.email : "Неизвестный участник" };
        }
        case "tag": {
          const t = tags.find((x) => x.id === key);
          return { text: t?.name ?? "Неизвестный тег", color: t?.color };
        }
        case "due":
          return { text: DUE_BUCKETS.find((b) => b.key === key)?.label ?? key };
        case "estimate":
          return { text: ESTIMATE_BUCKETS.find((b) => b.key === key)?.label ?? key };
        default:
          return { text: key };
      }
    },
    [statuses, projectsById, members, tags],
  );

  const groupOrder = useCallback(
    (field: GroupByField, keys: string[]): string[] => {
      // «Пусто» всегда в конце: иначе оно всплывает в начало и отвлекает.
      const rank = (key: string): number => {
        if (key === NONE_VALUE) return Number.POSITIVE_INFINITY;
        switch (field) {
          case "status":
            return statuses.find((s) => s.id === key)?.position ?? UNKNOWN_RANK;
          case "priority":
            return PRIORITY_WEIGHT[key as TaskPriority] ?? UNKNOWN_RANK;
          case "project":
            return projectsById.get(key)?.position ?? UNKNOWN_RANK;
          case "tag":
            return tags.find((t) => t.id === key)?.position ?? UNKNOWN_RANK;
          case "due":
            return DUE_BUCKETS.findIndex((b) => b.key === key);
          case "estimate":
            return ESTIMATE_BUCKETS.findIndex((b) => b.key === key);
          default:
            return UNKNOWN_RANK;
        }
      };
      return [...keys].sort((a, b) => {
        const ra = rank(a);
        const rb = rank(b);
        if (ra !== rb) return ra - rb;
        return labelForGroup(field, a).text.localeCompare(labelForGroup(field, b).text, "ru");
      });
    },
    [statuses, projectsById, tags, labelForGroup],
  );

  return useMemo(() => ({ labelForGroup, groupOrder }), [labelForGroup, groupOrder]);
}
