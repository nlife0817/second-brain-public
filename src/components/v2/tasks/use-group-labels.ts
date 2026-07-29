"use client";

// Подписи и порядок групп списка задач. Вынесены из TaskTableView, потому что
// мобильный список группирует те же строки по тем же полям: своя копия подписей
// разъехалась бы с таблицей при первом же новом поле группировки.

import { useCallback, useMemo } from "react";
import { PRIORITY_LABELS } from "@/components/v2/bits";
import type { GroupLabel } from "@/components/v2/tasks/TaskTable";
import type { TaskPriority } from "@/lib/core/types";
import { useV2Store } from "@/lib/core/ui-store";
import {
  DUE_BUCKETS,
  ESTIMATE_BUCKETS,
  NONE_VALUE,
  PRIORITY_WEIGHT,
  type GroupByField,
} from "@/lib/core/views";

export interface GroupPresentation {
  labelForGroup: (field: GroupByField, key: string) => GroupLabel;
  /** Порядок ключей группы: справочники имеют свой (позиция статуса и т.п.). */
  groupOrder: (field: GroupByField, keys: string[]) => string[];
}

export function useGroupPresentation(): GroupPresentation {
  const { statuses, tags, members, projects } = useV2Store();

  const projectsById = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects]);

  const labelForGroup = useCallback(
    (field: GroupByField, key: string): GroupLabel => {
      if (key === NONE_VALUE) {
        const empty: Record<string, string> = {
          status: "Без статуса",
          project: "Без проекта",
          assignee: "Без исполнителя",
          tag: "Без тегов",
          due: "Без срока",
          estimate: "Без оценки",
        };
        return { text: empty[field] ?? "Прочее" };
      }
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
            return statuses.find((s) => s.id === key)?.position ?? 9998;
          case "priority":
            return PRIORITY_WEIGHT[key as TaskPriority] ?? 9998;
          case "project":
            return projectsById.get(key)?.position ?? 9998;
          case "tag":
            return tags.find((t) => t.id === key)?.position ?? 9998;
          case "due":
            return DUE_BUCKETS.findIndex((b) => b.key === key);
          case "estimate":
            return ESTIMATE_BUCKETS.findIndex((b) => b.key === key);
          default:
            return 9998;
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

  return { labelForGroup, groupOrder };
}
