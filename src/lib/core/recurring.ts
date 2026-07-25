// Повторяющиеся задачи: правило хранит шаблон и дату следующего запуска.
// Материализация — идемпотентная (по next_run_date), вызывается из cron.

import { prepare, transaction } from "@/lib/sql";
import { DomainError } from "./http";
import { assertOrg } from "./policy";
import { requireProject } from "./projects";
import { createTask } from "./tasks";
import type { AuthContext, TaskPriority } from "./types";

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
      for (let i = 1; i <= 7 * Math.max(1, rule.interval); i++) {
        const probe = new Date(d);
        probe.setUTCDate(probe.getUTCDate() + i);
        if (days.includes(probe.getUTCDay())) return toIso(probe);
      }
      d.setUTCDate(d.getUTCDate() + 7 * rule.interval);
      return toIso(d);
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

export async function listRules(ctx: AuthContext): Promise<RecurringRule[]> {
  return prepare<RecurringRule>(
    `SELECT id, org_id, template, freq, interval, byweekday, bymonthday,
            start_date, until_date, next_run_date, created_at
     FROM core.recurring_rules WHERE org_id = ? ORDER BY next_run_date`,
  ).all(ctx.orgId);
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

export async function deleteRule(ctx: AuthContext, ruleId: string): Promise<void> {
  const changed = await prepare(
    `DELETE FROM core.recurring_rules WHERE id = ? AND org_id = ?`,
  ).run(ruleId, ctx.orgId);
  if (changed.changes === 0) throw new DomainError(404, "Rule not found");
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
      await transaction(async (tx) => {
        await tx
          .prepare(`UPDATE core.recurring_rules SET next_run_date = ?::date, last_task_id = ? WHERE id = ?`)
          .run(nextOccurrence(rule, today), task.id, rule.id);
      });
      created++;
    } catch {
      // Правило могло указывать на удалённый проект/статус — сдвигаем дату,
      // чтобы не зациклиться на нём при каждом прогоне.
      await prepare(`UPDATE core.recurring_rules SET next_run_date = ?::date WHERE id = ?`).run(
        nextOccurrence(rule, today),
        rule.id,
      );
    }
  }
  return { created };
}
