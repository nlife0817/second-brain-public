"use client";

// Подписи и порядок групп: как называется группа «в работе» и в каком порядке
// группы идут. Живёт отдельно от таблицы, потому что гант группирует строки той
// же настройкой представления — своя копия этих правил означала бы, что одна и
// та же группировка даёт в таблице и на ганте разные названия и разный порядок.
//
// Порядок читается из стора представлений: человек мог расставить группы руками
// (раздел «Группировка» в настройках списка), и настройка обязана действовать
// всюду одинаково — в таблице, на ганте и в мобильном списке. Отсюда следствие:
// хук работает только внутри `ViewStoreProvider`. Так и есть у всех трёх видов,
// а передавать порядок аргументом значило бы, что четвёртый вид его молча
// потеряет — то есть настройка не действует, хотя выставлена.

import { useCallback, useMemo } from "react";
import { PRIORITY_LABELS } from "@/components/v2/bits";
import type { TaskPriority } from "@/lib/core/types";
import { useV2Store } from "@/lib/core/ui-store";
import { useViewStore } from "@/lib/core/view-store";
import {
  DUE_BUCKETS,
  ESTIMATE_BUCKETS,
  NONE_VALUE,
  PRIORITY_WEIGHT,
  orderGroupKeys,
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

/** Приоритеты в порядке убывания — тот же, что задаёт PRIORITY_WEIGHT. */
const PRIORITY_KEYS: TaskPriority[] = ["urgent", "high", "medium", "low", "none"];

export function useGroupNaming(): GroupNaming {
  const { statuses, tags, members, projects } = useV2Store();
  const manualOrder = useViewStore((s) => s.groupOrder);
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
    (field: GroupByField, keys: string[]): string[] =>
      // Правило порядка — чистая `orderGroupKeys` в `views.ts`: ручная
      // расстановка вперёд, остальное по справочнику, «пусто» в конце.
      orderGroupKeys(keys, {
        manual: manualOrder[field],
        rank: (key) => {
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
        },
        label: (key) => labelForGroup(field, key).text,
      }),
    [manualOrder, statuses, projectsById, tags, labelForGroup],
  );

  return useMemo(() => ({ labelForGroup, groupOrder }), [labelForGroup, groupOrder]);
}

/** Значение поля группировки для настроек порядка: id, подпись и цвет метки. */
export interface GroupValue {
  id: string;
  label: string;
  color?: string;
}

/**
 * Все значения поля группировки в текущем порядке — то, что показывает раздел
 * «Группировка» в настройках списка. Берём справочник целиком, а не ключи из
 * данных: порядок должен переживать пустую группу, иначе расстановка сбрасывалась
 * бы каждый раз, когда в статусе не осталось задач.
 *
 * «Пусто» в список не входит: место у него всегда последнее (см. orderGroupKeys),
 * и строка, которую нельзя переставить, читается как сломанная.
 */
export function useGroupValues(field: GroupByField): GroupValue[] {
  const { statuses, tags, members, projects } = useV2Store();
  const { labelForGroup, groupOrder } = useGroupNaming();

  return useMemo(() => {
    const ids = ((): string[] => {
      switch (field) {
        case "status":
          return statuses.map((s) => s.id);
        case "priority":
          return PRIORITY_KEYS;
        case "project":
          return projects.map((p) => p.id);
        case "assignee":
          return members.map((m) => m.user_id);
        case "tag":
          return tags.map((t) => t.id);
        case "due":
          return DUE_BUCKETS.filter((b) => b.key !== NONE_VALUE).map((b) => b.key);
        case "estimate":
          return ESTIMATE_BUCKETS.map((b) => b.key);
        default:
          return [];
      }
    })();
    return groupOrder(field, ids).map((id) => {
      const { text, color } = labelForGroup(field, id);
      return { id, label: text, color };
    });
  }, [field, statuses, projects, members, tags, groupOrder, labelForGroup]);
}
