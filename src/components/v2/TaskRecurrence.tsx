"use client";

// Повтор задачи — прямо в её карточке. Отдельного экрана правил больше нет:
// расписание принадлежит задаче так же, как срок или исполнитель, а новая
// задача повторяет её текущее состояние (это считает сервер в момент
// срабатывания, а не слепок, снятый при включении).

import { useState } from "react";
import { Repeat, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { api } from "@/lib/core/client";
import { cn } from "@/lib/utils";

export type RecurrenceFreq = "daily" | "weekdays" | "weekly" | "monthly";

/** Зеркало core.recurring_rules в части, нужной карточке. */
export interface TaskRecurrenceRule {
  id: string;
  freq: RecurrenceFreq;
  interval: number;
  byweekday: number[] | null;
  bymonthday: number | null;
  start_date: string;
  until_date: string | null;
  next_run_date: string;
}

const FREQ_LABELS: Record<RecurrenceFreq, string> = {
  daily: "Каждый день",
  weekdays: "По будням",
  weekly: "Каждую неделю",
  monthly: "Каждый месяц",
};

const WEEKDAYS = [
  { value: 1, short: "Пн" },
  { value: 2, short: "Вт" },
  { value: 3, short: "Ср" },
  { value: 4, short: "Чт" },
  { value: 5, short: "Пт" },
  { value: 6, short: "Сб" },
  { value: 0, short: "Вс" },
];

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function formatDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
}

/** Человеческое описание расписания — «каждые 2 нед.: Пн, Чт». */
export function describeRecurrence(rule: {
  freq: RecurrenceFreq;
  interval: number;
  byweekday: number[] | null;
  bymonthday: number | null;
}): string {
  const every = rule.interval > 1 ? `каждые ${rule.interval} ` : "";
  switch (rule.freq) {
    case "daily":
      return rule.interval > 1 ? `Каждые ${rule.interval} дн.` : "Каждый день";
    case "weekdays":
      return "По будням (Пн–Пт)";
    case "weekly": {
      const days = (rule.byweekday ?? [])
        .map((d) => WEEKDAYS.find((w) => w.value === d)?.short)
        .filter(Boolean)
        .join(", ");
      const base = rule.interval > 1 ? `${every}нед.` : "Каждую неделю";
      return days ? `${base}: ${days}` : base;
    }
    case "monthly":
      return rule.bymonthday
        ? `${rule.interval > 1 ? `${every}мес.` : "Каждый месяц"}, ${rule.bymonthday}-го`
        : rule.interval > 1
          ? `${every}мес.`
          : "Каждый месяц";
  }
}

interface Draft {
  freq: RecurrenceFreq;
  interval: number;
  byweekday: number[];
  bymonthday: number | null;
  until_date: string;
}

function draftOf(rule: TaskRecurrenceRule | null): Draft {
  if (!rule) {
    return {
      freq: "weekly",
      interval: 1,
      byweekday: [new Date().getDay()],
      bymonthday: null,
      until_date: "",
    };
  }
  return {
    freq: rule.freq,
    interval: rule.interval,
    byweekday: rule.byweekday ?? [],
    bymonthday: rule.bymonthday,
    until_date: rule.until_date ?? "",
  };
}

const FIELD =
  "h-8 w-full rounded-lg border border-input bg-background px-2 text-sm text-foreground outline-none focus-visible:border-ring";

export function TaskRecurrence({
  orgId,
  taskId,
  rule,
  canEdit,
  onChange,
}: {
  orgId: string | null;
  taskId: string;
  rule: TaskRecurrenceRule | null;
  canEdit: boolean;
  onChange: (rule: TaskRecurrenceRule | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>(() => draftOf(rule));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Черновик — снимок правила: пришло другое правило (открыли другую задачу или
  // сохранили это) — снимок берётся заново. Правка состояния прямо в рендере, а
  // не в эффекте: эффект дал бы лишний проход с чужими значениями в полях.
  const [source, setSource] = useState<TaskRecurrenceRule | null>(rule);
  if (source !== rule) {
    setSource(rule);
    setDraft(draftOf(rule));
  }

  async function save() {
    if (!orgId || saving) return;
    setSaving(true);
    try {
      const saved = await api.put<TaskRecurrenceRule>(`/orgs/${orgId}/tasks/${taskId}/recurrence`, {
        freq: draft.freq,
        interval: draft.interval,
        byweekday: draft.freq === "weekly" ? draft.byweekday : null,
        bymonthday: draft.freq === "monthly" ? draft.bymonthday : null,
        start_date: rule?.start_date ?? todayIso(),
        until_date: draft.until_date || null,
      });
      onChange(saved);
      setError(null);
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось сохранить повтор");
    } finally {
      setSaving(false);
    }
  }

  async function disable() {
    if (!orgId || saving) return;
    setSaving(true);
    try {
      await api.del(`/orgs/${orgId}/tasks/${taskId}/recurrence`);
      onChange(null);
      setError(null);
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось выключить повтор");
    } finally {
      setSaving(false);
    }
  }

  if (!canEdit) {
    return (
      <span className="text-sm text-muted-foreground">
        {rule ? describeRecurrence(rule) : "Не повторяется"}
      </span>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={
            <Button
              variant="outline"
              size="sm"
              className={cn("h-7 gap-1.5 text-xs", rule && "border-primary text-primary")}
            />
          }
        >
          <Repeat className="size-3.5" />
          {rule ? describeRecurrence(rule) : "Не повторяется"}
        </PopoverTrigger>
        <PopoverContent align="start" className="w-72 gap-2.5 p-3">
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Повторять
            <select
              value={draft.freq}
              onChange={(e) => setDraft({ ...draft, freq: e.target.value as RecurrenceFreq })}
              className={FIELD}
            >
              {(Object.keys(FREQ_LABELS) as RecurrenceFreq[]).map((f) => (
                <option key={f} value={f}>
                  {FREQ_LABELS[f]}
                </option>
              ))}
            </select>
          </label>

          {draft.freq !== "weekdays" && (
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              Интервал ({draft.freq === "daily" ? "дней" : draft.freq === "weekly" ? "недель" : "месяцев"})
              <input
                type="number"
                min={1}
                max={365}
                value={draft.interval}
                onChange={(e) => setDraft({ ...draft, interval: Math.max(1, Number(e.target.value) || 1) })}
                className={FIELD}
              />
            </label>
          )}

          {draft.freq === "weekly" && (
            <div className="flex flex-col gap-1 text-xs text-muted-foreground">
              Дни недели
              <div className="flex flex-wrap gap-1">
                {WEEKDAYS.map((d) => (
                  <button
                    key={d.value}
                    onClick={() =>
                      setDraft({
                        ...draft,
                        byweekday: draft.byweekday.includes(d.value)
                          ? draft.byweekday.filter((x) => x !== d.value)
                          : [...draft.byweekday, d.value],
                      })
                    }
                    className={cn(
                      "size-7 rounded-lg border border-border text-xs",
                      draft.byweekday.includes(d.value)
                        ? "border-primary bg-primary text-primary-foreground"
                        : "hover:bg-muted",
                    )}
                  >
                    {d.short}
                  </button>
                ))}
              </div>
            </div>
          )}

          {draft.freq === "monthly" && (
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              День месяца (1–28)
              <input
                type="number"
                min={1}
                max={28}
                value={draft.bymonthday ?? ""}
                onChange={(e) =>
                  setDraft({ ...draft, bymonthday: e.target.value ? Number(e.target.value) : null })
                }
                placeholder="как сегодня"
                className={FIELD}
              />
            </label>
          )}

          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Закончить (необязательно)
            <input
              type="date"
              value={draft.until_date}
              onChange={(e) => setDraft({ ...draft, until_date: e.target.value })}
              className={FIELD}
            />
          </label>

          {error && <p className="text-xs text-destructive">{error}</p>}

          <div className="flex items-center gap-2">
            <Button size="sm" onClick={() => void save()} disabled={saving}>
              {saving ? "Сохраняю…" : "Сохранить"}
            </Button>
            {rule && (
              <Button variant="ghost" size="sm" onClick={() => void disable()} disabled={saving}>
                Выключить
              </Button>
            )}
          </div>
          <p className="text-[11px] leading-4 text-muted-foreground">
            Копия задачи создаётся фоновым заданием в назначенный день и повторяет её текущее
            состояние. Пропущенные дни не догоняются.
          </p>
        </PopoverContent>
      </Popover>

      {rule && (
        <>
          <span className="text-xs text-muted-foreground">
            следующая {formatDate(rule.next_run_date)}
            {rule.until_date && <> · до {formatDate(rule.until_date)}</>}
          </span>
          <button
            onClick={() => void disable()}
            title="Выключить повтор"
            className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="size-3.5" />
          </button>
        </>
      )}
    </div>
  );
}
