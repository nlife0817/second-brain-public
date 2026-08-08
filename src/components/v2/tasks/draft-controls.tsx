"use client";

// Редакторы полей черновика задачи, общие для строки создания в таблице «Все
// задачи» и для строки добавления подзадачи в карточке. Компоненты рисуют
// только содержимое поповера — триггер остаётся за вызывающим: в таблице это
// ячейка во всю ширину колонки, в карточке — компактный чип.

import { Check, X } from "lucide-react";
import { useMemo } from "react";
import { Avatar, PRIORITY_LABELS } from "@/components/v2/bits";
import { assigneeChoice } from "@/lib/core/assignable";
import { resolveProjectSetId, statusesOfSet } from "@/lib/core/status-model";
import type { TaskPriority, TaskStatus } from "@/lib/core/types";
import { useV2Store } from "@/lib/core/ui-store";
import { cn } from "@/lib/utils";
import { formatEstimate } from "./cells";

export const PRIORITY_ORDER: TaskPriority[] = ["urgent", "high", "medium", "low", "none"];
export const ESTIMATE_PRESETS = [15, 30, 60, 120, 240, 480];

/** Размеры поповеров: списки прокручиваются, формы — нет. */
export const PRIORITY_POPOVER = "w-44 p-1";
export const MENU_POPOVER = "max-h-72 w-56 overflow-y-auto p-1";
export const WIDE_MENU_POPOVER = "max-h-72 w-60 overflow-y-auto p-1";
export const ESTIMATE_POPOVER = "w-52 gap-2 p-2.5";
export const FIELD_POPOVER = "w-64 gap-2 p-2.5";

const ROW = "flex w-full items-center gap-2 rounded px-2 py-1 text-sm hover:bg-muted";
const FIELD_INPUT =
  "h-8 rounded-lg border border-input bg-transparent px-2 text-sm text-foreground outline-none focus-visible:border-ring";

/**
 * Статусы набора, в котором родится черновик. Набор берём у первого проекта
 * размещения — новая задача рождается в его процессе; без проекта (личный
 * черновик) — набор организации по умолчанию. Тот же принцип, что и в карточке
 * (`resolveProjectSetId`): сырой `null` показал бы статусы всех наборов сразу.
 */
export function useDraftSetStatuses(projectIds: string[]): TaskStatus[] {
  const all = useV2Store((s) => s.statuses);
  const statusSets = useV2Store((s) => s.statusSets);
  const projects = useV2Store((s) => s.projects);
  return useMemo(() => {
    const projectSetId = projects.find((p) => projectIds.includes(p.id))?.status_set_id ?? null;
    return statusesOfSet(all, resolveProjectSetId(statusSets, projectSetId));
  }, [all, statusSets, projects, projectIds]);
}

/** Проекты, куда участник вправе положить задачу. Архивные не предлагаем. */
export function useWritableProjects() {
  const projects = useV2Store((s) => s.projects);
  return useMemo(
    () => projects.filter((p) => !p.archived_at && (p.my_role === "admin" || p.my_role === "editor")),
    [projects],
  );
}

export function PriorityMenu({
  value,
  onChange,
}: {
  value: TaskPriority;
  onChange: (priority: TaskPriority) => void;
}) {
  return (
    <>
      {PRIORITY_ORDER.map((p) => (
        <button key={p} onClick={() => onChange(p)} className={ROW}>
          <span className={cn("size-2 shrink-0 rounded-full", PRIORITY_LABELS[p].dot)} />
          <span className="flex-1 text-left">{PRIORITY_LABELS[p].label}</span>
          {value === p && <Check className="size-3.5" />}
        </button>
      ))}
    </>
  );
}

/** «Без статуса» здесь нет намеренно: пустого статуса у задачи не бывает. */
export function StatusMenu({
  value,
  onChange,
  statuses,
}: {
  value: string | null;
  onChange: (statusId: string) => void;
  /**
   * Чем ограничен выбор. По умолчанию — весь справочник организации; экран со
   * своим набором статусов (проект в режиме «Разработка») передаёт статусы
   * набора: новая задача рождается в его процессе, а не в чужом.
   */
  statuses?: TaskStatus[];
}) {
  const all = useV2Store((s) => s.statuses);
  const options = statuses ?? all;
  return (
    <>
      {options.map((s) => (
        <button key={s.id} onClick={() => onChange(s.id)} className={ROW}>
          <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: s.color }} />
          <span className="flex-1 truncate text-left">{s.name}</span>
          {value === s.id && <Check className="size-3.5 shrink-0" />}
        </button>
      ))}
    </>
  );
}

export function ProjectsMenu({
  value,
  onChange,
}: {
  value: string[];
  onChange: (projectIds: string[]) => void;
}) {
  const writable = useWritableProjects();
  return (
    <>
      {writable.map((p) => (
        <button
          key={p.id}
          onClick={() =>
            onChange(value.includes(p.id) ? value.filter((id) => id !== p.id) : [...value, p.id])
          }
          className={ROW}
        >
          <span className="size-2 shrink-0 rounded-sm" style={{ backgroundColor: p.color }} />
          <span className="flex-1 truncate text-left">{p.name}</span>
          {value.includes(p.id) && <Check className="size-3.5 shrink-0" />}
        </button>
      ))}
      {writable.length === 0 && (
        <p className="px-2 py-1.5 text-xs text-muted-foreground">
          Нет проектов, куда можно добавить задачу — она уйдёт в личный инбокс.
        </p>
      )}
    </>
  );
}

/**
 * Исполнители черновика. Закрытый проект пускает в исполнители только своих
 * участников — правило сервера (`assertAssigneesInClosedProjects`), которое
 * интерфейс обязан повторять, иначе выбор заканчивается отказом при сохранении.
 */
export function AssigneesMenu({
  value,
  projectIds,
  onChange,
}: {
  value: string[];
  projectIds: string[];
  onChange: (userIds: string[]) => void;
}) {
  const members = useV2Store((s) => s.members);
  const projects = useV2Store((s) => s.projects);
  const choice = assigneeChoice(members, projects, projectIds, value);
  return (
    <>
      {choice.members.map((m) => (
        <button
          key={m.user_id}
          onClick={() =>
            onChange(
              value.includes(m.user_id)
                ? value.filter((id) => id !== m.user_id)
                : [...value, m.user_id],
            )
          }
          className={ROW}
        >
          <Avatar
            user={{ id: m.user_id, email: m.email, name: m.name, avatar_url: m.avatar_url }}
            size="xs"
          />
          <span className="flex-1 truncate text-left">{m.name || m.email}</span>
          {value.includes(m.user_id) && <Check className="size-3.5 shrink-0" />}
        </button>
      ))}
      {choice.members.length === 0 && (
        <p className="px-2 py-1.5 text-xs text-muted-foreground">
          {members.length === 0 ? "Участники ещё не загружены" : "В закрытом проекте некого назначить"}
        </p>
      )}
      {choice.restrictedBy.length > 0 && (
        <p className="border-t border-border px-2 py-1.5 text-[11px] leading-4 text-muted-foreground">
          Только участники закрытого проекта «{choice.restrictedBy.join("», «")}»
        </p>
      )}
    </>
  );
}

export function TagsMenu({
  value,
  onChange,
}: {
  value: string[];
  onChange: (tagIds: string[]) => void;
}) {
  const tags = useV2Store((s) => s.tags);
  return (
    <>
      {tags.map((t) => (
        <button
          key={t.id}
          onClick={() =>
            onChange(value.includes(t.id) ? value.filter((id) => id !== t.id) : [...value, t.id])
          }
          className={ROW}
        >
          <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: t.color }} />
          <span className="flex-1 truncate text-left">{t.name}</span>
          {value.includes(t.id) && <Check className="size-3.5 shrink-0" />}
        </button>
      ))}
      {tags.length === 0 && <p className="px-2 py-1.5 text-xs text-muted-foreground">Тегов пока нет</p>}
    </>
  );
}

export function EstimateForm({
  value,
  onChange,
}: {
  value: number | null;
  onChange: (minutes: number | null) => void;
}) {
  return (
    <>
      <div className="flex flex-wrap gap-1">
        {ESTIMATE_PRESETS.map((m) => (
          <button
            key={m}
            onClick={() => onChange(m)}
            className={cn(
              "rounded border border-border px-2 py-1 text-xs hover:bg-muted",
              value === m && "border-primary bg-primary/10 text-primary",
            )}
          >
            {formatEstimate(m)}
          </button>
        ))}
      </div>
      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
        Минут
        <input
          type="number"
          min={0}
          step={5}
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value === "" ? null : Math.max(0, Number(e.target.value)))}
          className={FIELD_INPUT}
        />
      </label>
      {value != null && (
        <button
          onClick={() => onChange(null)}
          className="flex items-center gap-1.5 rounded px-1 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <X className="size-3.5" /> Убрать оценку
        </button>
      )}
    </>
  );
}
