"use client";

// Компактные редакторы полей задачи — «чипы»: значок или короткая подпись,
// раскрывающая то же меню, что и ячейка таблицы (`draft-controls`). Нужны там,
// где колонок нет и раскладывать поля не по чему: карточка задачи (подзадачи) и
// вид «Бэклог».
//
// Чипы работают парой {value, onChange}, а не черновиком целиком: те же самые
// контролы обслуживают и строку создания, и строку существующей задачи — у
// второй никакого `TaskDraft` нет, есть задача и PATCH.

import { CalendarDays, Clock, UserPlus } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  AvatarStack,
  PRIORITY_LABELS,
  PriorityDot,
  chipStyle,
  dueTone,
  formatDue,
} from "@/components/v2/bits";
import { DuePicker } from "@/components/v2/DuePicker";
import { defaultStatus } from "@/lib/core/status-model";
import type { TaskDraft } from "@/lib/core/task-draft";
import type { CustomField, TaskPriority, TaskStatus } from "@/lib/core/types";
import { useV2Store } from "@/lib/core/ui-store";
import { cn } from "@/lib/utils";
import { formatEstimate } from "./cells";
import {
  AssigneesMenu,
  ESTIMATE_POPOVER,
  EstimateForm,
  FIELD_POPOVER,
  MENU_POPOVER,
  PRIORITY_POPOVER,
  PriorityMenu,
  StatusMenu,
  WIDE_MENU_POPOVER,
} from "./draft-controls";
import { DraftFieldControl, describeFieldValue } from "./draft-fields";

export const CHIP =
  "flex h-7 shrink-0 items-center gap-1 rounded-md px-1.5 text-xs transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";
export const CHIP_EMPTY = "text-muted-foreground/70";
export const CHIP_SET = "text-foreground";

/**
 * Незаполненный параметр: строка не должна шуметь пятью пустыми
 * плейсхолдерами, поэтому такой чип проявляется по наведению.
 *
 * `data-[popup-open]` обязателен — иначе уведённая со строки мышь гасит чип
 * вместе с его открытым меню. На телефоне наведения не существует, а карточку
 * там открывают три экрана: под `[data-mobile-v2]` (атрибут стоит на `<html>`)
 * пустые чипы видны всегда, иначе параметры задачи недостижимы вовсе.
 *
 * Группу задаёт вызывающий — `group/sub` на своей строке.
 */
export const CHIP_ON_HOVER =
  "opacity-0 transition-opacity focus-visible:opacity-100 data-[popup-open]:opacity-100 " +
  "group-hover/sub:opacity-100 group-focus-within/sub:opacity-100 [[data-mobile-v2]_&]:opacity-100";

interface DraftChipProps {
  draft: TaskDraft;
  patch: (change: Partial<TaskDraft>) => void;
}

export function PriorityChip({
  value,
  onChange,
  className,
}: {
  value: TaskPriority;
  onChange: (priority: TaskPriority) => void;
  className?: string;
}) {
  const set = value !== "none";
  return (
    <Popover>
      <PopoverTrigger
        render={
          <button
            className={cn(CHIP, set ? CHIP_SET : CHIP_EMPTY, className)}
            title={`Приоритет: ${PRIORITY_LABELS[value].label}`}
          />
        }
      >
        {set ? (
          <PriorityDot priority={value} />
        ) : (
          <span className="size-2 rounded-full border border-dashed border-muted-foreground/60" />
        )}
      </PopoverTrigger>
      <PopoverContent align="start" className={PRIORITY_POPOVER}>
        <PriorityMenu value={value} onChange={onChange} />
      </PopoverContent>
    </Popover>
  );
}

export function StatusChip({
  value,
  onChange,
  statuses,
  className,
}: {
  value: string | null;
  onChange: (statusId: string | null) => void;
  /** Чем ограничен выбор — например, набором статусов проекта. По умолчанию весь справочник организации. */
  statuses?: TaskStatus[];
  className?: string;
}) {
  const all = useV2Store((s) => s.statuses);
  const options = statuses ?? all;
  // Пока статус не выбран, показываем тот, с которым задача родится, — иначе
  // чип врёт про будущий результат.
  const status = options.find((s) => s.id === value) ?? defaultStatus(options);
  return (
    <Popover>
      <PopoverTrigger
        render={
          <button
            className={cn(CHIP, "max-w-32", status ? CHIP_SET : CHIP_EMPTY, className)}
            title={status ? `Статус: ${status.name}` : "Статус"}
          />
        }
      >
        {status ? (
          <span
            className="tinted-chip inline-flex max-w-full items-center gap-1 truncate rounded-full px-1.5 py-0.5 text-[11px] font-medium"
            style={chipStyle(status.color)}
          >
            <span className="size-1.5 shrink-0 rounded-full" style={{ backgroundColor: status.color }} />
            <span className="truncate">{status.name}</span>
          </span>
        ) : (
          <span className="size-2 rounded-full border border-dashed border-muted-foreground/60" />
        )}
      </PopoverTrigger>
      <PopoverContent align="start" className={MENU_POPOVER}>
        <StatusMenu value={value} onChange={onChange} statuses={statuses} />
      </PopoverContent>
    </Popover>
  );
}

export function AssigneesChip({
  value,
  projectIds,
  onChange,
  className,
}: {
  value: string[];
  projectIds: string[];
  onChange: (userIds: string[]) => void;
  className?: string;
}) {
  const members = useV2Store((s) => s.members);
  const selected = members.filter((m) => value.includes(m.user_id));
  return (
    <Popover>
      <PopoverTrigger
        render={
          <button
            className={cn(CHIP, selected.length > 0 ? CHIP_SET : CHIP_EMPTY, className)}
            title="Исполнители"
          />
        }
      >
        {selected.length > 0 ? (
          <AvatarStack
            users={selected.map((m) => ({
              id: m.user_id,
              email: m.email,
              name: m.name,
              avatar_url: m.avatar_url,
            }))}
            max={2}
          />
        ) : (
          <UserPlus className="size-3.5" />
        )}
      </PopoverTrigger>
      <PopoverContent align="start" className={WIDE_MENU_POPOVER}>
        <AssigneesMenu value={value} projectIds={projectIds} onChange={onChange} />
      </PopoverContent>
    </Popover>
  );
}

export function DueChip({
  date,
  time,
  done = false,
  onChange,
  className,
}: {
  date: string | null;
  time: string | null;
  /** Просроченный срок у завершённой задачи красным не подсвечиваем. */
  done?: boolean;
  onChange: (next: { due_date: string | null; due_time: string | null }) => void;
  className?: string;
}) {
  const text = formatDue(date, time);
  return (
    <DuePicker
      date={date}
      time={time}
      triggerClassName={cn(CHIP, text ? CHIP_SET : CHIP_EMPTY, className)}
      onCommit={onChange}
    >
      {/* Подпись на самом триггере: DuePicker пробрасывает наружу только класс. */}
      {text ? (
        <span className={cn("tabular-nums", dueTone(date, done))} title="Срок">
          {text}
        </span>
      ) : (
        <CalendarDays className="size-3.5" aria-label="Срок" />
      )}
    </DuePicker>
  );
}

export function EstimateChip({
  value,
  onChange,
  className,
}: {
  value: number | null;
  onChange: (minutes: number | null) => void;
  className?: string;
}) {
  const set = value != null;
  return (
    <Popover>
      <PopoverTrigger
        render={<button className={cn(CHIP, set ? CHIP_SET : CHIP_EMPTY, className)} title="Оценка" />}
      >
        {set ? (
          <span className="tabular-nums">{formatEstimate(value)}</span>
        ) : (
          <Clock className="size-3.5" />
        )}
      </PopoverTrigger>
      <PopoverContent align="start" className={ESTIMATE_POPOVER}>
        <EstimateForm value={value} onChange={onChange} />
      </PopoverContent>
    </Popover>
  );
}

export function CustomFieldChip({ field, draft, patch }: DraftChipProps & { field: CustomField }) {
  const text = describeFieldValue(field, draft.field_values[field.id]);
  return (
    <>
      <span className="truncate text-muted-foreground" title={field.name}>
        {field.name}
      </span>
      <Popover>
        <PopoverTrigger
          render={<button className={cn(CHIP, "w-full justify-start", text ? CHIP_SET : CHIP_EMPTY)} />}
        >
          <span className="truncate">{text || "Не задано"}</span>
        </PopoverTrigger>
        <PopoverContent align="start" className={FIELD_POPOVER}>
          <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            {field.name}
          </span>
          <DraftFieldControl
            field={field}
            value={draft.field_values[field.id]}
            onChange={(value) => patch({ field_values: { ...draft.field_values, [field.id]: value } })}
          />
        </PopoverContent>
      </Popover>
    </>
  );
}
