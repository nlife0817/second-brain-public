"use client";

// Повторяющиеся задачи. API правил был с фазы 2, а экрана к нему не было —
// правила заводились только через API или прямо в базе.
//
// Материализует правила cron (/api/v2/cron раз в 10 минут): здесь только
// расписание и шаблон, самих созданных задач тут нет — они живут в проекте.

import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarClock, Pencil, Plus, Repeat, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { PRIORITY_LABELS } from "@/components/v2/bits";
import { assigneeChoice } from "@/lib/core/assignable";
import { api } from "@/lib/core/client";
import { cachedGet, invalidate, peek, seed } from "@/lib/core/query";
import type { TaskPriority } from "@/lib/core/types";
import { useV2Store } from "@/lib/core/ui-store";
import { cn } from "@/lib/utils";

type Freq = "daily" | "weekdays" | "weekly" | "monthly";

interface RecurringTemplate {
  title: string;
  description?: string;
  priority?: TaskPriority;
  status_id?: string | null;
  project_id?: string | null;
  assignee_ids?: string[];
}

export interface RecurringRule {
  id: string;
  template: RecurringTemplate;
  freq: Freq;
  interval: number;
  byweekday: number[] | null;
  bymonthday: number | null;
  start_date: string;
  until_date: string | null;
  next_run_date: string;
  created_at: string;
}

const FREQ_LABELS: Record<Freq, string> = {
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
  return new Date(y, m - 1, d).toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" });
}

/** Человеческое описание расписания — «каждые 2 недели: Пн, Чт». */
function describe(rule: RecurringRule): string {
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
  id: string | null;
  title: string;
  description: string;
  priority: TaskPriority;
  project_id: string;
  status_id: string;
  assignee_ids: string[];
  freq: Freq;
  interval: number;
  byweekday: number[];
  bymonthday: number | null;
  start_date: string;
  until_date: string;
}

function emptyDraft(): Draft {
  return {
    id: null,
    title: "",
    description: "",
    priority: "none",
    project_id: "",
    status_id: "",
    assignee_ids: [],
    freq: "weekly",
    interval: 1,
    byweekday: [new Date().getDay()],
    bymonthday: null,
    start_date: todayIso(),
    until_date: "",
  };
}

function draftOf(rule: RecurringRule): Draft {
  return {
    id: rule.id,
    title: rule.template.title,
    description: rule.template.description ?? "",
    priority: rule.template.priority ?? "none",
    project_id: rule.template.project_id ?? "",
    status_id: rule.template.status_id ?? "",
    assignee_ids: rule.template.assignee_ids ?? [],
    freq: rule.freq,
    interval: rule.interval,
    byweekday: rule.byweekday ?? [],
    bymonthday: rule.bymonthday,
    start_date: rule.start_date,
    until_date: rule.until_date ?? "",
  };
}

const FIELD = "h-8 w-full rounded-lg border border-input bg-transparent px-2 text-sm outline-none focus-visible:border-ring";

export function RecurringClient({ initial }: { initial: RecurringRule[] }) {
  const { orgId, projects, statuses, members, orgRole } = useV2Store();
  const canEdit = orgRole !== null && orgRole !== "guest";

  const [rules, setRules] = useState<RecurringRule[]>(initial);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);

  const path = orgId ? `/orgs/${orgId}/recurring` : null;

  // Список посчитан на сервере — в кэш вместо первого запроса.
  useEffect(() => {
    if (path) seed(path, initial);
  }, [path, initial]);

  const load = useCallback(
    async (opts: { force?: boolean } = {}) => {
      if (!path) return;
      if (opts.force || peek(path) === undefined) setLoading(true);
      try {
        setRules(await cachedGet<RecurringRule[]>(path, opts));
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Не удалось загрузить правила");
      } finally {
        setLoading(false);
      }
    },
    [path],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const projectName = useMemo(() => new Map(projects.map((p) => [p.id, p.name])), [projects]);

  async function save() {
    if (!orgId || !draft || !draft.title.trim()) return;
    setSaving(true);
    const payload = {
      template: {
        title: draft.title.trim(),
        description: draft.description || undefined,
        priority: draft.priority,
        project_id: draft.project_id || null,
        status_id: draft.status_id || null,
        assignee_ids: draft.assignee_ids,
      },
      freq: draft.freq,
      interval: draft.interval,
      byweekday: draft.freq === "weekly" ? draft.byweekday : null,
      bymonthday: draft.freq === "monthly" ? draft.bymonthday : null,
      start_date: draft.start_date,
      until_date: draft.until_date || null,
    };
    try {
      if (draft.id) await api.patch(`/orgs/${orgId}/recurring/${draft.id}`, payload);
      else await api.post(`/orgs/${orgId}/recurring`, payload);
      setDraft(null);
      await load({ force: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось сохранить правило");
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    if (!orgId) return;
    const previous = rules;
    setRules((prev) => prev.filter((r) => r.id !== id));
    try {
      await api.del(`/orgs/${orgId}/recurring/${id}`);
      // Список правок живёт в состоянии экрана; кэш надо согласовать, иначе
      // возврат на экран воскресит удалённое правило.
      invalidate(`/orgs/${orgId}/recurring`);
    } catch (e) {
      setRules(previous);
      setError(e instanceof Error ? e.message : "Не удалось удалить правило");
    }
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-3 border-b border-border px-6 py-3.5">
        <Repeat className="size-4 text-muted-foreground" />
        <h1 className="text-base font-semibold">Повторяющиеся задачи</h1>
        <span className="flex-1" />
        {canEdit && (
          <Button size="sm" onClick={() => setDraft(emptyDraft())}>
            <Plus className="size-4" />
            Правило
          </Button>
        )}
      </header>

      <div className="flex-1 overflow-y-auto px-6 py-4">
        <div className="mx-auto flex max-w-3xl flex-col gap-3">
          {error && (
            <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>
          )}
          {loading && <p className="text-sm text-muted-foreground">Загрузка…</p>}
          {!loading && rules.length === 0 && (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Правил пока нет. Задача по правилу создаётся автоматически в назначенный день.
            </p>
          )}

          {rules.map((rule) => (
            <div key={rule.id} className="group rounded-lg border border-border p-3">
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{rule.template.title}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {describe(rule)}
                    {rule.template.project_id && (
                      <> · {projectName.get(rule.template.project_id) ?? "недоступный проект"}</>
                    )}
                    {!rule.template.project_id && <> · личная задача</>}
                  </p>
                  <p className="mt-1 inline-flex items-center gap-1 text-xs text-muted-foreground">
                    <CalendarClock className="size-3.5" />
                    Следующая: {formatDate(rule.next_run_date)}
                    {rule.until_date && <> · до {formatDate(rule.until_date)}</>}
                  </p>
                </div>
                {canEdit && (
                  <div className="flex shrink-0 gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                    <Button variant="ghost" size="icon-xs" title="Изменить" onClick={() => setDraft(draftOf(rule))}>
                      <Pencil className="size-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      title="Удалить"
                      onClick={() => void remove(rule.id)}
                      className="hover:text-destructive"
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      <Sheet open={!!draft} onOpenChange={(open) => !open && setDraft(null)}>
        <SheetContent className="w-full sm:max-w-md">
          <SheetHeader>
            <SheetTitle>{draft?.id ? "Изменить правило" : "Новое правило"}</SheetTitle>
          </SheetHeader>
          {draft && (
            <div className="flex flex-col gap-3 overflow-y-auto px-4 pb-4">
              <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                Название задачи
                <input
                  value={draft.title}
                  onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                  placeholder="Что создавать по расписанию"
                  className={cn(FIELD, "text-foreground")}
                />
              </label>

              <div className="grid grid-cols-2 gap-2">
                <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                  Проект
                  <select
                    value={draft.project_id}
                    onChange={(e) => setDraft({ ...draft, project_id: e.target.value })}
                    className={cn(FIELD, "bg-background text-foreground")}
                  >
                    <option value="">Личная задача</option>
                    {projects.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                  Приоритет
                  <select
                    value={draft.priority}
                    onChange={(e) => setDraft({ ...draft, priority: e.target.value as TaskPriority })}
                    className={cn(FIELD, "bg-background text-foreground")}
                  >
                    {(Object.keys(PRIORITY_LABELS) as TaskPriority[]).map((p) => (
                      <option key={p} value={p}>
                        {PRIORITY_LABELS[p].label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                  Статус
                  <select
                    value={draft.status_id}
                    onChange={(e) => setDraft({ ...draft, status_id: e.target.value })}
                    className={cn(FIELD, "bg-background text-foreground")}
                  >
                    <option value="">По умолчанию</option>
                    {statuses.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                  Повтор
                  <select
                    value={draft.freq}
                    onChange={(e) => setDraft({ ...draft, freq: e.target.value as Freq })}
                    className={cn(FIELD, "bg-background text-foreground")}
                  >
                    {(Object.keys(FREQ_LABELS) as Freq[]).map((f) => (
                      <option key={f} value={f}>
                        {FREQ_LABELS[f]}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              {draft.freq !== "weekdays" && (
                <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                  Интервал ({draft.freq === "daily" ? "дней" : draft.freq === "weekly" ? "недель" : "месяцев"})
                  <input
                    type="number"
                    min={1}
                    max={365}
                    value={draft.interval}
                    onChange={(e) => setDraft({ ...draft, interval: Math.max(1, Number(e.target.value) || 1) })}
                    className={cn(FIELD, "text-foreground")}
                  />
                </label>
              )}

              {draft.freq === "weekly" && (
                <div className="flex flex-col gap-1 text-xs text-muted-foreground">
                  Дни недели
                  <div className="flex gap-1">
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
                          "size-8 rounded-lg border border-border text-xs",
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
                    placeholder="как в дате начала"
                    className={cn(FIELD, "text-foreground")}
                  />
                </label>
              )}

              <div className="grid grid-cols-2 gap-2">
                <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                  Начало
                  <input
                    type="date"
                    value={draft.start_date}
                    onChange={(e) => setDraft({ ...draft, start_date: e.target.value })}
                    className={cn(FIELD, "text-foreground")}
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                  Закончить (необязательно)
                  <input
                    type="date"
                    value={draft.until_date}
                    onChange={(e) => setDraft({ ...draft, until_date: e.target.value })}
                    className={cn(FIELD, "text-foreground")}
                  />
                </label>
              </div>

              <div className="flex flex-col gap-1 text-xs text-muted-foreground">
                Исполнители
                <div className="flex flex-wrap gap-1">
                  {/* Закрытый проект пускает в исполнители только своих: правило
                      с посторонним просто не материализуется. */}
                  {assigneeChoice(
                    members,
                    projects,
                    draft.project_id ? [draft.project_id] : [],
                    draft.assignee_ids,
                  ).members.map((m) => {
                    const on = draft.assignee_ids.includes(m.user_id);
                    return (
                      <button
                        key={m.user_id}
                        onClick={() =>
                          setDraft({
                            ...draft,
                            assignee_ids: on
                              ? draft.assignee_ids.filter((id) => id !== m.user_id)
                              : [...draft.assignee_ids, m.user_id],
                          })
                        }
                        className={cn(
                          "rounded-lg border border-border px-2 py-1 text-xs",
                          on ? "border-primary bg-primary/10 text-primary" : "hover:bg-muted",
                        )}
                      >
                        {m.name || m.email}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="mt-1 flex gap-2">
                <Button onClick={() => void save()} disabled={!draft.title.trim() || saving}>
                  {saving ? "Сохраняю…" : "Сохранить"}
                </Button>
                <Button variant="ghost" onClick={() => setDraft(null)}>
                  Отмена
                </Button>
              </div>
              <p className="text-[11px] leading-4 text-muted-foreground">
                Задачи создаются фоновым заданием раз в 10 минут. Пропущенные дни не догоняются:
                после перерыва расписание продолжается от ближайшей будущей даты.
              </p>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
