// Повторяющиеся задачи: правило хранит шаблон и дату следующего запуска.
// Материализация — идемпотентная (по next_run_date), вызывается из cron.

import { prepare } from "@/lib/sql";
import { DomainError } from "./http";
import { assertOrg, canOrg, effectiveProjectRole, PolicyError } from "./policy";
import { requireProject } from "./projects";
import { createTask } from "./tasks";
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
}

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

/** Правило видно автору и тем, кто видит его проект: шаблон содержит и текст задачи, и исполнителей. */
export async function listRules(ctx: AuthContext): Promise<RecurringRule[]> {
  const rows = await prepare<RecurringRule & { created_by: string | null }>(
    `SELECT id, org_id, template, freq, interval, byweekday, bymonthday,
            start_date, until_date, next_run_date, created_at, created_by
     FROM core.recurring_rules WHERE org_id = ? ORDER BY next_run_date`,
  ).all(ctx.orgId);

  const projectIds = [...new Set(rows.map((r) => r.template?.project_id).filter((id): id is string => !!id))];
  const visible = new Set<string>();
  if (projectIds.length > 0) {
    const ph = projectIds.map(() => "?").join(",");
    const projects = await prepare<PolicyProject>(
      `SELECT id, org_id, visibility FROM core.projects WHERE id IN (${ph})`,
    ).all(projectIds);
    for (const p of projects) {
      if (effectiveProjectRole(ctx, p) !== null) visible.add(p.id);
    }
  }

  return rows
    .filter((r) => r.created_by === ctx.user.id || (r.template?.project_id && visible.has(r.template.project_id)))
    .map(({ created_by: _created_by, ...rule }) => rule);
}

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

/** Удалять правило вправе автор, админ проекта правила или админ организации. */
export async function deleteRule(ctx: AuthContext, ruleId: string): Promise<void> {
  const rule = await prepare<{ created_by: string | null; template: RecurringTemplate }>(
    `SELECT created_by, template FROM core.recurring_rules WHERE id = ? AND org_id = ?`,
  ).get(ruleId, ctx.orgId);
  if (!rule) throw new DomainError(404, "Rule not found");

  if (rule.created_by !== ctx.user.id && !canOrg(ctx, "org.members.manage")) {
    if (!rule.template?.project_id) throw new PolicyError("recurring.delete");
    await requireProject(ctx, rule.template.project_id, "project.update");
  }

  await prepare(`DELETE FROM core.recurring_rules WHERE id = ? AND org_id = ?`).run(ruleId, ctx.orgId);
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
            r.start_date, r.until_date, r.next_run_date, r.created_at,
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
      const task = await createTask(ctx, {
        title: rule.template.title,
        description: rule.template.description,
        priority: rule.template.priority,
        status_id: rule.template.status_id ?? null,
        due_date: rule.next_run_date,
        placements: rule.template.project_id ? [{ project_id: rule.template.project_id }] : undefined,
        assignee_ids: rule.template.assignee_ids,
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
