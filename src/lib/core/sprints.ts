// Доменный сервис спринтов: список с итогами, CRUD, старт и завершение.
//
// Спринт принадлежит проекту, задача — не более чем одному спринту. Правила
// переходов, ёмкости и сдвига сроков живут в чистой `sprint-model.ts` — их же
// повторяет интерфейс, чтобы показать итог до нажатия.

import { prepare, transaction, type TxContext } from "@/lib/sql";
import { emitEvent } from "./events";
import { DomainError } from "./http";
import { requireProject } from "./projects";
import {
  canCompleteSprint,
  carryDefault,
  nextSprintDraft,
  shiftTaskDates,
  shouldShiftDates,
  sprintStartBlock,
  startBlockMessage,
  type CarryTarget,
} from "./sprint-model";
import type { AuthContext, Sprint, SprintWithTotals, StatusCategory } from "./types";

const SPRINT_COLUMNS = `id, org_id, project_id, name, goal, starts_on, ends_on, state,
   capacity_minutes, position, started_at, completed_at, created_by, created_at, updated_at`;

/**
 * Итоги считаются вместе со списком: экран планирования показывает «набрано /
 * ёмкость» у каждого спринта, и отдельный запрос на спринт означал бы N+1 на
 * каждое открытие экрана. Архивные задачи в счёт не идут — их в спринте быть не
 * должно, а если попали (статус переехал в «Архив»), то планирование они не
 * описывают.
 */
const TOTALS_SELECT = `
  count(t.id) FILTER (WHERE t.id IS NOT NULL)::int AS task_count,
  count(t.id) FILTER (WHERE t.completed_at IS NOT NULL)::int AS done_count,
  coalesce(sum(t.estimated_minutes), 0)::int AS estimated_minutes,
  count(t.id) FILTER (WHERE t.id IS NOT NULL AND t.estimated_minutes IS NULL)::int AS unestimated_count`;

// --- Чтение -----------------------------------------------------------------------

export async function listSprints(
  ctx: AuthContext,
  projectId: string,
  opts: { includeCompleted?: boolean } = {},
): Promise<SprintWithTotals[]> {
  await requireProject(ctx, projectId, "project.view");
  return prepare<SprintWithTotals>(
    // s.* — у спринта нет тяжёлых колонок вроде описания задачи, и списку
    // нужны все: экран рисует и даты, и ёмкость, и состояние.
    `SELECT s.*,
            ${TOTALS_SELECT}
     FROM core.sprints s
     LEFT JOIN core.tasks t ON t.sprint_id = s.id
     WHERE s.org_id = ? AND s.project_id = ?
       AND (?::boolean OR s.state <> 'completed')
     GROUP BY s.id
     ORDER BY s.position, s.created_at`,
  ).all(ctx.orgId, projectId, opts.includeCompleted ?? false);
}

export async function getSprint(sprintId: string): Promise<Sprint | undefined> {
  return prepare<Sprint>(`SELECT ${SPRINT_COLUMNS} FROM core.sprints WHERE id = ?`).get(sprintId);
}

/**
 * Спринт этой организации с проверкой права на его проект. 404 на чужой и на
 * невидимый — как `requireProject`: подтверждать существование спринта в
 * закрытом проекте нельзя.
 */
export async function requireSprint(
  ctx: AuthContext,
  sprintId: string,
  action: "project.view" | "sprint.manage",
): Promise<Sprint> {
  const sprint = await getSprint(sprintId);
  if (!sprint || sprint.org_id !== ctx.orgId) throw new DomainError(404, "Sprint not found");
  await requireProject(ctx, sprint.project_id, action);
  return sprint;
}

/** Спринты проекта без итогов — для правил, которым нужен только состав. */
async function sprintsOfProject(projectId: string): Promise<Sprint[]> {
  return prepare<Sprint>(
    `SELECT ${SPRINT_COLUMNS} FROM core.sprints WHERE project_id = ? ORDER BY position, created_at`,
  ).all(projectId);
}

// --- CRUD ---------------------------------------------------------------------------

export interface CreateSprintInput {
  name?: string;
  goal?: string;
  starts_on?: string | null;
  ends_on?: string | null;
  capacity_minutes?: number | null;
}

export async function createSprint(
  ctx: AuthContext,
  projectId: string,
  input: CreateSprintInput = {},
): Promise<Sprint> {
  const project = await requireProject(ctx, projectId, "sprint.manage");
  const existing = await sprintsOfProject(projectId);
  // Форма нужна, только если что-то не так с умолчанием: продолжение
  // предыдущего той же длины со следующим номером в имени.
  const draft = nextSprintDraft(existing[existing.length - 1], today());

  const sprint = await transaction(async (tx) => {
    const row = await tx
      .prepare<Sprint>(
        `INSERT INTO core.sprints
           (org_id, project_id, name, goal, starts_on, ends_on, capacity_minutes, position, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?,
                 COALESCE((SELECT max(position) + 1 FROM core.sprints WHERE project_id = ?), 1),
                 ?)
         RETURNING ${SPRINT_COLUMNS}`,
      )
      .get(
        ctx.orgId,
        projectId,
        (input.name ?? draft.name).trim(),
        input.goal ?? "",
        input.starts_on !== undefined ? input.starts_on : draft.starts_on,
        input.ends_on !== undefined ? input.ends_on : draft.ends_on,
        input.capacity_minutes ?? null,
        projectId,
        ctx.user.id,
      );
    if (!row) throw new DomainError(500, "Failed to create sprint");
    await emitEvent(tx, {
      orgId: ctx.orgId,
      actorId: ctx.user.id,
      entityType: "project",
      entityId: projectId,
      verb: "sprint.created",
      payload: { sprint_id: row.id, name: row.name, project_name: project.name },
    });
    return row;
  });
  return sprint;
}

export interface UpdateSprintInput {
  name?: string;
  goal?: string;
  starts_on?: string | null;
  ends_on?: string | null;
  capacity_minutes?: number | null;
  /**
   * Сдвинуть вместе со спринтом и сроки его задач — те, что попадали в старое
   * окно. Правило то же, что при переезде задачи (`shiftTaskDates`): даты за
   * пределами окна это чужая договорённость, их не трогаем.
   */
  shift_task_dates?: boolean;
}

export async function updateSprint(
  ctx: AuthContext,
  sprintId: string,
  patch: UpdateSprintInput,
): Promise<Sprint> {
  const sprint = await requireSprint(ctx, sprintId, "sprint.manage");
  const next = {
    name: patch.name !== undefined ? patch.name.trim() : sprint.name,
    goal: patch.goal !== undefined ? patch.goal : sprint.goal,
    starts_on: patch.starts_on !== undefined ? patch.starts_on : sprint.starts_on,
    ends_on: patch.ends_on !== undefined ? patch.ends_on : sprint.ends_on,
    capacity_minutes:
      patch.capacity_minutes !== undefined ? patch.capacity_minutes : sprint.capacity_minutes,
  };
  const windowMoved = next.starts_on !== sprint.starts_on || next.ends_on !== sprint.ends_on;

  return transaction(async (tx) => {
    const row = await tx
      .prepare<Sprint>(
        `UPDATE core.sprints
            SET name = ?, goal = ?, starts_on = ?, ends_on = ?, capacity_minutes = ?
          WHERE id = ?
          RETURNING ${SPRINT_COLUMNS}`,
      )
      .get(next.name, next.goal, next.starts_on, next.ends_on, next.capacity_minutes, sprintId);
    if (!row) throw new DomainError(500, "Failed to update sprint");

    if (windowMoved && patch.shift_task_dates) {
      await shiftSprintTasks(tx, sprintId, sprint, row);
    }

    await emitEvent(tx, {
      orgId: ctx.orgId,
      actorId: ctx.user.id,
      entityType: "project",
      entityId: sprint.project_id,
      verb: "sprint.updated",
      payload: { sprint_id: sprintId, name: row.name, fields: Object.keys(patch) },
    });
    return row;
  });
}

export async function deleteSprint(ctx: AuthContext, sprintId: string): Promise<void> {
  const sprint = await requireSprint(ctx, sprintId, "sprint.manage");
  await transaction(async (tx) => {
    // Задачи не трогаем: FK `on delete set null` вернёт их в бэклог проекта.
    // Терять при удалении спринта саму работу нельзя — это тот же принцип, по
    // которому удаление проекта не удаляет его задачи.
    await emitEvent(tx, {
      orgId: ctx.orgId,
      actorId: ctx.user.id,
      entityType: "project",
      entityId: sprint.project_id,
      verb: "sprint.deleted",
      payload: { sprint_id: sprintId, name: sprint.name },
    });
    await tx.prepare(`DELETE FROM core.sprints WHERE id = ? AND org_id = ?`).run(sprintId, ctx.orgId);
  });
}

// --- Старт и завершение ------------------------------------------------------------------

export async function startSprint(ctx: AuthContext, sprintId: string): Promise<Sprint> {
  const sprint = await requireSprint(ctx, sprintId, "sprint.manage");
  const siblings = await sprintsOfProject(sprint.project_id);
  const block = sprintStartBlock(siblings, sprintId);
  if (block) {
    const active = siblings.find((s) => s.state === "active");
    throw new DomainError(422, startBlockMessage(block, active?.name));
  }

  return transaction(async (tx) => {
    const row = await tx
      .prepare<Sprint>(
        `UPDATE core.sprints SET state = 'active', started_at = now()
          WHERE id = ? RETURNING ${SPRINT_COLUMNS}`,
      )
      .get(sprintId);
    if (!row) throw new DomainError(500, "Failed to start sprint");
    await emitEvent(tx, {
      orgId: ctx.orgId,
      actorId: ctx.user.id,
      entityType: "project",
      entityId: sprint.project_id,
      verb: "sprint.started",
      payload: { sprint_id: sprintId, name: row.name, ends_on: row.ends_on },
    });
    return row;
  });
}

export interface CompleteSprintInput {
  /** Куда уводить незакрытые задачи; `null`/пусто — все в бэклог. */
  carry_to?: string | null;
  /** Точечные решения; для неупомянутых применяется `carryDefault`. */
  decisions?: Array<{ task_id: string; target: CarryTarget }>;
  /** Сдвигать ли сроки уезжающих в спринт задач. */
  shift_dates?: boolean;
}

export interface CompleteSprintResult {
  sprint: Sprint;
  carried: number;
  returned: number;
}

/** Незакрытая задача спринта — то, что предстоит куда-то деть при завершении. */
export interface SprintLeftover {
  id: string;
  title: string;
  start_date: string | null;
  due_date: string | null;
  estimated_minutes: number | null;
  category: StatusCategory | null;
  sprint_carry_count: number;
}

/** Что осталось незакрытым в спринте — для диалога завершения. */
export async function listSprintLeftovers(
  ctx: AuthContext,
  sprintId: string,
): Promise<SprintLeftover[]> {
  await requireSprint(ctx, sprintId, "project.view");
  return prepare<SprintLeftover>(
    `SELECT t.id, t.title, t.start_date, t.due_date, t.estimated_minutes,
            st.category, t.sprint_carry_count
       FROM core.tasks t
       LEFT JOIN core.task_statuses st ON st.id = t.status_id
      WHERE t.sprint_id = ? AND t.completed_at IS NULL
        AND (st.category IS NULL OR st.category <> 'archived')
      ORDER BY t.created_at`,
  ).all(sprintId);
}

/**
 * Завершение спринта: незакрытые задачи расходятся по решению человека, спринт
 * закрывается. Событий на задачи здесь НЕ пишем — одно событие на спринт:
 * полсотни строк в ленте и push всей команде на финише итерации это не отчёт, а
 * шум (сознательное исключение из правила «мутация без события — регресс», как
 * правка справочника статусов).
 */
export async function completeSprint(
  ctx: AuthContext,
  sprintId: string,
  input: CompleteSprintInput = {},
): Promise<CompleteSprintResult> {
  const sprint = await requireSprint(ctx, sprintId, "sprint.manage");
  if (!canCompleteSprint(sprint)) {
    throw new DomainError(422, "Завершить можно только активный спринт");
  }

  const target = input.carry_to ? await getSprint(input.carry_to) : null;
  if (input.carry_to) {
    if (!target || target.org_id !== ctx.orgId || target.project_id !== sprint.project_id) {
      throw new DomainError(422, "Переносить задачи можно только в спринт того же проекта");
    }
    if (target.state === "completed") {
      throw new DomainError(422, "Нельзя перенести задачи в уже завершённый спринт");
    }
  }

  const leftovers = await listSprintLeftovers(ctx, sprintId);
  const decided = new Map((input.decisions ?? []).map((d) => [d.task_id, d.target]));
  const toSprint: SprintLeftover[] = [];
  const toBacklog: SprintLeftover[] = [];
  for (const task of leftovers) {
    const choice = decided.get(task.id) ?? carryDefault(task.category ?? undefined);
    // Без цели переноса «в спринт» означает то же, что и «в бэклог»: задача
    // всё равно должна выйти из закрываемой итерации.
    if (choice === "sprint" && target) toSprint.push(task);
    else toBacklog.push(task);
  }

  const result = await transaction(async (tx) => {
    for (const task of toSprint) {
      // toSprint непуст только когда цель есть — см. разбор решений выше.
      if (!target) break;
      const dates =
        input.shift_dates && shouldShiftDates(task, sprint)
          ? shiftTaskDates(task, sprint, target)
          : { start_date: task.start_date, due_date: task.due_date };
      await tx
        .prepare(
          `UPDATE core.tasks
              SET sprint_id = ?, sprint_carry_count = sprint_carry_count + 1,
                  start_date = ?, due_date = ?
            WHERE id = ?`,
        )
        .run(target.id, dates.start_date, dates.due_date, task.id);
    }
    if (toBacklog.length > 0) {
      const ph = toBacklog.map(() => "?").join(",");
      await tx
        .prepare(`UPDATE core.tasks SET sprint_id = NULL WHERE id IN (${ph})`)
        .run(toBacklog.map((t) => t.id));
    }

    const row = await tx
      .prepare<Sprint>(
        `UPDATE core.sprints SET state = 'completed', completed_at = now()
          WHERE id = ? RETURNING ${SPRINT_COLUMNS}`,
      )
      .get(sprintId);
    if (!row) throw new DomainError(500, "Failed to complete sprint");

    await emitEvent(tx, {
      orgId: ctx.orgId,
      actorId: ctx.user.id,
      entityType: "project",
      entityId: sprint.project_id,
      verb: "sprint.completed",
      payload: {
        sprint_id: sprintId,
        name: row.name,
        carried: toSprint.length,
        returned: toBacklog.length,
        carry_to: target?.id ?? null,
        carry_to_name: target?.name ?? null,
      },
    });
    return row;
  });

  return { sprint: result, carried: toSprint.length, returned: toBacklog.length };
}

// --- Массовый перенос -----------------------------------------------------------------

/**
 * Сдвиг сроков задач вслед за сдвигом окна самого спринта. Правило то же, что у
 * переезда задачи: едут только даты, стоявшие внутри старого окна.
 */
async function shiftSprintTasks(
  tx: TxContext,
  sprintId: string,
  before: Sprint,
  after: Sprint,
): Promise<void> {
  const tasks = await tx
    .prepare<{ id: string; start_date: string | null; due_date: string | null }>(
      `SELECT id, start_date, due_date FROM core.tasks WHERE sprint_id = ?`,
    )
    .all(sprintId);
  for (const task of tasks) {
    if (!shouldShiftDates(task, before)) continue;
    const dates = shiftTaskDates(task, before, after);
    if (dates.start_date === task.start_date && dates.due_date === task.due_date) continue;
    await tx
      .prepare(`UPDATE core.tasks SET start_date = ?, due_date = ? WHERE id = ?`)
      .run(dates.start_date, dates.due_date, task.id);
  }
}

/** Сегодняшний ISO-день по времени сервера — только для подстановки в форму. */
function today(): string {
  return new Date().toISOString().slice(0, 10);
}
