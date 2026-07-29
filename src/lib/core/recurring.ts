// Повторяющиеся задачи: правило хранит расписание и дату следующего запуска.
// Материализация — идемпотентная (по next_run_date), вызывается из cron.
//
// Правил два вида. Привязанное к задаче (`task_id`) — то, что живёт в карточке:
// шаблон новой задачи берётся из живой строки в момент срабатывания, поэтому
// переименование или смена исполнителя сразу отражаются на следующих повторах.
// Старые правила со своим `template` остались от отдельного экрана повторов и
// продолжают работать как прежде.

import { prepare } from "@/lib/sql";
import { DomainError } from "./http";
import { assertOrg, canOrg, effectiveProjectRole, PolicyError } from "./policy";
import { requireProject } from "./projects";
import { createTask, requireTaskAccess } from "./tasks";
import type { AuthContext, PolicyProject, TaskPriority } from "./types";

export type Freq = "daily" | "weekdays" | "weekly" | "monthly";

export interface RecurringTemplate {
  title: string;
  description?: string;
  priority?: TaskPriority;
  status_id?: string | null;
  project_id?: string | null;
  assignee_ids?: string[];
}

export interface RecurringRule {
  id: string;
  org_id: string;
  template: RecurringTemplate;
  freq: Freq;
  interval: number;
  byweekday: number[] | null;
  bymonthday: number | null;
  start_date: string;
  until_date: string | null;
  next_run_date: string;
  created_at: string;
  /** Задача, чьё это расписание; null — правило из старого экрана повторов. */
  task_id?: string | null;
}

/** Расписание задачи — то, что правится в карточке. */
export interface TaskSchedule {
  freq: Freq;
  interval: number;
  byweekday: number[] | null;
  bymonthday: number | null;
  start_date: string;
  until_date: string | null;
}

const RULE_COLUMNS = `id, org_id, template, freq, interval, byweekday, bymonthday,
            start_date, until_date, next_run_date, created_at, task_id`;

function toIso(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

/** Следующая дата после `from` (исключительно) по правилу. */
export function nextOccurrence(
  rule: Pick<RecurringRule, "freq" | "interval" | "byweekday" | "bymonthday">,
  from: string,
): string {
  const d = new Date(`${from}T00:00:00Z`);
  switch (rule.freq) {
    case "daily":
      d.setUTCDate(d.getUTCDate() + rule.interval);
      return toIso(d);
    case "weekdays": {
      do {
        d.setUTCDate(d.getUTCDate() + 1);
      } while (d.getUTCDay() === 0 || d.getUTCDay() === 6);
      return toIso(d);
    }
    case "weekly": {
      const days = (rule.byweekday ?? [d.getUTCDay()]).slice().sort((a, b) => a - b);
      // Внутри текущей недели — ближайший следующий день из списка.
      for (let i = 1; i <= 6; i++) {
        const probe = new Date(d);
        probe.setUTCDate(probe.getUTCDate() + i);
        if (probe.getUTCDay() > d.getUTCDay() && days.includes(probe.getUTCDay())) return toIso(probe);
      }
      // Иначе первый день из списка через `interval` недель — интервал
      // обязан соблюдаться, иначе «каждые 2 недели» станет «каждую неделю».
      const jump = new Date(d);
      jump.setUTCDate(jump.getUTCDate() + 7 * rule.interval - d.getUTCDay() + days[0]);
      return toIso(jump);
    }
    case "monthly": {
      const day = rule.bymonthday ?? d.getUTCDate();
      const probe = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + rule.interval, 1));
      // День 29–31 в коротком месяце съезжает на последний день месяца.
      const lastDay = new Date(Date.UTC(probe.getUTCFullYear(), probe.getUTCMonth() + 1, 0)).getUTCDate();
      probe.setUTCDate(Math.min(day, lastDay));
      return toIso(probe);
    }
  }
}

/**
 * Правило видно автору и тем, кто видит его проект: шаблон содержит и текст
 * задачи, и исполнителей. Расписания задач (`task_id`) сюда не попадают — их
 * показывает и правит сама карточка, где права считаются по задаче.
 */
export async function listRules(ctx: AuthContext): Promise<RecurringRule[]> {
  const rows = await prepare<RecurringRule & { created_by: string | null }>(
    `SELECT ${RULE_COLUMNS}, created_by
     FROM core.recurring_rules WHERE org_id = ? AND task_id IS NULL ORDER BY next_run_date`,
  ).all(ctx.orgId);

  const projectIds = [...new Set(rows.map((r) => r.template?.project_id).filter((id): id is string => !!id))];
  const visible = new Set<string>();
  if (projectIds.length > 0) {
    const ph = projectIds.map(() => "?").join(",");
    const projects = await prepare<PolicyProject>(
      `SELECT id, org_id, default_role FROM core.projects WHERE id IN (${ph})`,
    ).all(projectIds);
    for (const p of projects) {
      if (effectiveProjectRole(ctx, p) !== null) visible.add(p.id);
    }
  }

  return rows
    .filter((r) => r.created_by === ctx.user.id || (r.template?.project_id && visible.has(r.template.project_id)))
    .map((r) => {
      const rule = { ...r } as RecurringRule & { created_by?: string | null };
      delete rule.created_by;
      return rule as RecurringRule;
    });
}

// --- Расписание задачи (карточка) ---------------------------------------------

/** Расписание задачи или null. Доступ к задаче проверяет вызывающий. */
export async function getTaskRule(taskId: string, orgId: string): Promise<RecurringRule | null> {
  const row = await prepare<RecurringRule>(
    `SELECT ${RULE_COLUMNS} FROM core.recurring_rules WHERE task_id = ? AND org_id = ?`,
  ).get(taskId, orgId);
  return row ?? null;
}

/** Первая дата не в прошлом по этому расписанию. */
function firstRun(schedule: TaskSchedule, today: string): string {
  let next = schedule.start_date;
  let guard = 0;
  while (next < today && guard++ < 400) next = nextOccurrence(schedule, next);
  return next;
}

/**
 * Включить или изменить повтор задачи. Право то же, что и на правку задачи:
 * расписание — такое же её свойство, как срок или исполнитель.
 */
export async function setTaskRule(
  ctx: AuthContext,
  taskId: string,
  schedule: TaskSchedule,
  today: string,
): Promise<RecurringRule> {
  await requireTaskAccess(ctx, taskId, "edit");
  const nextRun = firstRun(schedule, today);
  const row = await prepare<RecurringRule>(
    `INSERT INTO core.recurring_rules
       (org_id, task_id, template, freq, interval, byweekday, bymonthday,
        start_date, until_date, next_run_date, created_by)
     VALUES (?, ?, '{}'::jsonb, ?, ?, ?::jsonb, ?, ?::date, ?::date, ?::date, ?)
     ON CONFLICT (task_id) WHERE task_id IS NOT NULL DO UPDATE
       SET freq = excluded.freq, interval = excluded.interval, byweekday = excluded.byweekday,
           bymonthday = excluded.bymonthday, start_date = excluded.start_date,
           until_date = excluded.until_date, next_run_date = excluded.next_run_date
     RETURNING ${RULE_COLUMNS}`,
  ).get(
    ctx.orgId,
    taskId,
    schedule.freq,
    schedule.interval,
    schedule.byweekday ? JSON.stringify(schedule.byweekday) : null,
    schedule.bymonthday,
    schedule.start_date,
    schedule.until_date,
    nextRun,
    ctx.user.id,
  );
  if (!row) throw new DomainError(500, "Failed to save schedule");
  return row;
}

/** Выключить повтор задачи. */
export async function clearTaskRule(ctx: AuthContext, taskId: string): Promise<void> {
  await requireTaskAccess(ctx, taskId, "edit");
  await prepare(`DELETE FROM core.recurring_rules WHERE task_id = ? AND org_id = ?`).run(taskId, ctx.orgId);
}

// --- Правила отдельной сущностью (наследие экрана повторов) ---------------------

export async function createRule(
  ctx: AuthContext,
  input: {
    template: RecurringTemplate;
    freq: Freq;
    interval?: number;
    byweekday?: number[] | null;
    bymonthday?: number | null;
    start_date: string;
    until_date?: string | null;
  },
): Promise<RecurringRule> {
  if (input.template.project_id) {
    await requireProject(ctx, input.template.project_id, "task.create");
  } else {
    assertOrg(ctx, "task.create.personal");
  }
  const row = await prepare<RecurringRule>(
    `INSERT INTO core.recurring_rules
       (org_id, template, freq, interval, byweekday, bymonthday, start_date, until_date, next_run_date, created_by)
     VALUES (?, ?::jsonb, ?, ?, ?::jsonb, ?, ?::date, ?::date, ?::date, ?)
     RETURNING id, org_id, template, freq, interval, byweekday, bymonthday,
               start_date, until_date, next_run_date, created_at`,
  ).get(
    ctx.orgId,
    JSON.stringify(input.template),
    input.freq,
    input.interval ?? 1,
    input.byweekday ? JSON.stringify(input.byweekday) : null,
    input.bymonthday ?? null,
    input.start_date,
    input.until_date ?? null,
    input.start_date,
    ctx.user.id,
  );
  if (!row) throw new DomainError(500, "Failed to create rule");
  return row;
}

/** Права на правку и удаление совпадают: автор, админ проекта или админ организации. */
async function requireRuleOwnership(ctx: AuthContext, ruleId: string): Promise<RecurringTemplate> {
  const rule = await prepare<{ created_by: string | null; template: RecurringTemplate }>(
    `SELECT created_by, template FROM core.recurring_rules WHERE id = ? AND org_id = ?`,
  ).get(ruleId, ctx.orgId);
  if (!rule) throw new DomainError(404, "Rule not found");

  if (rule.created_by !== ctx.user.id && !canOrg(ctx, "org.members.manage")) {
    if (!rule.template?.project_id) throw new PolicyError("recurring.manage");
    await requireProject(ctx, rule.template.project_id, "project.update");
  }
  return rule.template;
}

export async function deleteRule(ctx: AuthContext, ruleId: string): Promise<void> {
  await requireRuleOwnership(ctx, ruleId);
  await prepare(`DELETE FROM core.recurring_rules WHERE id = ? AND org_id = ?`).run(ruleId, ctx.orgId);
}

/**
 * Правка правила. Расписание меняется вместе с `next_run_date`: оставить
 * старую дату — значит выпустить следующую задачу по отменённому расписанию.
 * Пересчитываем от начала, но не раньше сегодняшнего дня.
 */
export async function updateRule(
  ctx: AuthContext,
  ruleId: string,
  patch: {
    template?: RecurringTemplate;
    freq?: Freq;
    interval?: number;
    byweekday?: number[] | null;
    bymonthday?: number | null;
    start_date?: string;
    until_date?: string | null;
  },
  today: string,
): Promise<RecurringRule> {
  const previous = await requireRuleOwnership(ctx, ruleId);

  // Переезд правила в другой проект — это создание задач там: право нужно
  // проверить по новому проекту, а не по старому.
  const nextProjectId = patch.template ? patch.template.project_id : previous.project_id;
  if (patch.template) {
    if (nextProjectId) await requireProject(ctx, nextProjectId, "task.create");
    else assertOrg(ctx, "task.create.personal");
  }

  const current = await prepare<RecurringRule>(
    `SELECT id, org_id, template, freq, interval, byweekday, bymonthday,
            start_date, until_date, next_run_date, created_at
     FROM core.recurring_rules WHERE id = ? AND org_id = ?`,
  ).get(ruleId, ctx.orgId);
  if (!current) throw new DomainError(404, "Rule not found");

  const merged = {
    template: patch.template ?? current.template,
    freq: patch.freq ?? current.freq,
    interval: patch.interval ?? current.interval,
    byweekday: patch.byweekday !== undefined ? patch.byweekday : current.byweekday,
    bymonthday: patch.bymonthday !== undefined ? patch.bymonthday : current.bymonthday,
    start_date: patch.start_date ?? current.start_date,
    until_date: patch.until_date !== undefined ? patch.until_date : current.until_date,
  };

  const scheduleChanged =
    merged.freq !== current.freq ||
    merged.interval !== current.interval ||
    JSON.stringify(merged.byweekday) !== JSON.stringify(current.byweekday) ||
    merged.bymonthday !== current.bymonthday ||
    merged.start_date !== current.start_date;

  let nextRun = current.next_run_date;
  if (scheduleChanged) {
    nextRun = merged.start_date;
    // Догонять пропущенное не нужно — доводим до первой даты не в прошлом.
    let guard = 0;
    while (nextRun < today && guard++ < 400) nextRun = nextOccurrence(merged, nextRun);
  }

  const row = await prepare<RecurringRule>(
    `UPDATE core.recurring_rules
     SET template = ?::jsonb, freq = ?, interval = ?, byweekday = ?::jsonb, bymonthday = ?,
         start_date = ?::date, until_date = ?::date, next_run_date = ?::date
     WHERE id = ? AND org_id = ?
     RETURNING id, org_id, template, freq, interval, byweekday, bymonthday,
               start_date, until_date, next_run_date, created_at`,
  ).get(
    JSON.stringify(merged.template),
    merged.freq,
    merged.interval,
    merged.byweekday ? JSON.stringify(merged.byweekday) : null,
    merged.bymonthday,
    merged.start_date,
    merged.until_date,
    nextRun,
    ruleId,
    ctx.orgId,
  );
  if (!row) throw new DomainError(404, "Rule not found");
  return row;
}

/** Поля новой задачи — то, что материализация передаёт в `createTask`. */
interface TaskShape {
  title: string;
  description?: string;
  priority?: TaskPriority;
  status_id?: string | null;
  estimated_minutes?: number | null;
  placements?: Array<{ project_id: string }>;
  assignee_ids?: string[];
  tag_ids?: string[];
}

function shapeOfTemplate(template: RecurringTemplate): TaskShape | null {
  if (!template?.title) return null;
  return {
    title: template.title,
    description: template.description,
    priority: template.priority,
    status_id: template.status_id ?? null,
    placements: template.project_id ? [{ project_id: template.project_id }] : undefined,
    assignee_ids: template.assignee_ids,
  };
}

/**
 * Слепок живой задачи. Именно живой: смысл повтора в карточке в том, что
 * следующая задача повторяет текущее состояние исходной, а не то, каким оно
 * было в день включения расписания.
 */
async function shapeOfTask(taskId: string, orgId: string): Promise<TaskShape | null> {
  const task = await prepare<{
    title: string;
    description: string;
    priority: TaskPriority;
    status_id: string | null;
    status_kind: string | null;
    estimated_minutes: number | null;
  }>(
    `SELECT t.title, t.description, t.priority, t.status_id, s.kind AS status_kind, t.estimated_minutes
     FROM core.tasks t
     LEFT JOIN core.task_statuses s ON s.id = t.status_id
     WHERE t.id = ?`,
  ).get(taskId);
  if (!task) return null;

  const [projects, assignees, tags] = await Promise.all([
    prepare<{ project_id: string }>(`SELECT project_id FROM core.task_projects WHERE task_id = ?`).all(taskId),
    prepare<{ user_id: string }>(`SELECT user_id FROM core.task_assignees WHERE task_id = ?`).all(taskId),
    prepare<{ tag_id: string }>(`SELECT tag_id FROM core.task_tags WHERE task_id = ?`).all(taskId),
  ]);

  // Исходная задача к этому дню обычно уже завершена или в архиве — копия,
  // рождённая сразу «сделанной», бессмысленна. Берём первый рабочий статус.
  let statusId = task.status_id;
  if (task.status_kind !== "open") {
    const open = await prepare<{ id: string }>(
      `SELECT id FROM core.task_statuses WHERE org_id = ? AND kind = 'open' ORDER BY position LIMIT 1`,
    ).get(orgId);
    statusId = open?.id ?? null;
  }

  return {
    title: task.title,
    description: task.description,
    priority: task.priority,
    status_id: statusId,
    estimated_minutes: task.estimated_minutes,
    placements: projects.map((p) => ({ project_id: p.project_id })),
    assignee_ids: assignees.map((a) => a.user_id),
    tag_ids: tags.map((t) => t.tag_id),
  };
}

/**
 * Материализация: для каждого правила, у которого подошёл срок, создаём задачу
 * от имени автора правила и сдвигаем next_run_date. Пропущенные дни не
 * «догоняются» — создаётся одна задача, дальше расписание идёт от сегодня.
 */
export async function materializeDueRules(today: string): Promise<{ created: number }> {
  const due = await prepare<
    RecurringRule & { created_by: string | null; user_email: string | null }
  >(
    `SELECT r.id, r.org_id, r.template, r.freq, r.interval, r.byweekday, r.bymonthday,
            r.start_date, r.until_date, r.next_run_date, r.created_at, r.task_id,
            r.created_by, u.email AS user_email
     FROM core.recurring_rules r
     LEFT JOIN core.users u ON u.id = r.created_by
     WHERE r.next_run_date <= ?::date
       AND (r.until_date IS NULL OR r.until_date >= ?::date)`,
  ).all(today, today);

  let created = 0;
  for (const rule of due) {
    if (!rule.created_by) continue;
    const orgRole = await prepare<{ role: string }>(
      `SELECT role FROM core.org_members WHERE org_id = ? AND user_id = ?`,
    ).get(rule.org_id, rule.created_by);
    if (!orgRole) continue; // автор покинул организацию — правило простаивает

    const ctx: AuthContext = {
      user: {
        id: rule.created_by,
        auth_user_id: null,
        email: rule.user_email ?? "",
        name: "",
        avatar_url: null,
        created_at: "",
        updated_at: "",
      },
      orgId: rule.org_id,
      orgRole: orgRole.role as AuthContext["orgRole"],
      projectRoles: new Map(
        (
          await prepare<{ project_id: string; role: string }>(
            `SELECT pm.project_id, pm.role FROM core.project_members pm
             JOIN core.projects p ON p.id = pm.project_id
             WHERE p.org_id = ? AND pm.user_id = ?`,
          ).all(rule.org_id, rule.created_by)
        ).map((r) => [r.project_id, r.role as never]),
      ),
    };

    // Захват правила: сдвигаем дату ДО создания задачи и только если её ещё
    // никто не сдвинул. Иначе параллельный тик cron создаст дубль задачи.
    const claimed = await prepare(
      `UPDATE core.recurring_rules SET next_run_date = ?::date
       WHERE id = ? AND next_run_date = ?::date`,
    ).run(nextOccurrence(rule, today), rule.id, rule.next_run_date);
    if (claimed.changes === 0) continue;

    try {
      // Расписание задачи повторяет саму задачу, какой она стала к этому дню;
      // старое правило — свой слепок полей.
      const shape = rule.task_id
        ? await shapeOfTask(rule.task_id, rule.org_id)
        : shapeOfTemplate(rule.template);
      if (!shape) {
        console.error(`[recurring] правило ${rule.id}: исходная задача не найдена`);
        continue;
      }
      const task = await createTask(ctx, {
        ...shape,
        due_date: rule.next_run_date,
        source: "recurring",
      });
      await prepare(`UPDATE core.recurring_rules SET last_task_id = ? WHERE id = ?`).run(task.id, rule.id);
      created++;
    } catch (err) {
      // Правило могло указывать на удалённый проект/статус. Дата уже сдвинута,
      // поэтому следующий тик не зациклится; логируем, чтобы это было видно.
      console.error(`[recurring] правило ${rule.id} не материализовано:`, err);
    }
  }
  return { created };
}
