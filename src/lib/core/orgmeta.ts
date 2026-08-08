// Справочники организации: статусы задач и теги.

import { prepare, transaction, type TxContext } from "@/lib/sql";
import { DomainError } from "./http";
import { assertOrg } from "./policy";
import {
  arrangementError,
  deleteBlockMessage,
  fallbackStatusId,
  isWorkingCategory,
  moveBlockMessage,
  statusDeleteBlock,
  statusMoveBlock,
  STATUS_CATEGORIES,
} from "./status-model";
import type { AuthContext, CoreTag, StatusCategory, StatusSet, TaskStatus } from "./types";

// --- Статусы -----------------------------------------------------------------------

/**
 * Колонка `kind` в выборке лишняя для типов, но нужна на проводе: пока живут
 * вкладки со старым бандлом, они сравнивают `kind === 'open'`. Уйдёт вместе с
 * дропом колонки следующим выкатом (см. 0041_core_status_categories.sql).
 */
const STATUS_SELECT = `id, org_id, set_id, name, color, category, is_default, position, kind`;

/**
 * Порядок справочника — категория, потом позиция. Одной позиции недостаточно:
 * так справочник шёл до 0045, и статус, добавленный после архивного, оказывался
 * в выпадающих списках между рабочими. Позиции выровнены той же миграцией, но
 * сортировку держим явной — она и есть правило, а числа лишь его отражают.
 */
const STATUS_ORDER = `array_position(array['backlog', 'in_progress', 'done', 'archived'], category), position, created_at`;

/**
 * Все статусы организации — со всеми наборами сразу. Стор интерфейса держит их
 * целиком: задача живёт в нескольких проектах, и её статус может оказаться из
 * чужого набора — список, суженный до одного набора, показал бы такую задачу
 * без статуса. Сужение до набора — дело экрана (`statusesOfSet`).
 */
export async function listStatuses(ctx: AuthContext): Promise<TaskStatus[]> {
  return prepare<TaskStatus>(
    `SELECT ${STATUS_SELECT} FROM core.task_statuses
     WHERE org_id = ? ORDER BY ${STATUS_ORDER}`,
  ).all(ctx.orgId);
}

/** Статусы одного набора — в границах набора живут все инварианты справочника. */
async function statusesOfSet(setId: string): Promise<TaskStatus[]> {
  return prepare<TaskStatus>(
    `SELECT ${STATUS_SELECT} FROM core.task_statuses WHERE set_id = ? ORDER BY ${STATUS_ORDER}`,
  ).all(setId);
}

/**
 * Статус новой задачи в наборе. `ORDER BY is_default DESC` вместо
 * `WHERE is_default` — защита от набора, заведённого старым кодом в окно
 * выката: без флага каждое создание задачи в нём отвечало бы 500.
 *
 * `setId` не задан — берём набор организации по умолчанию: так рождается задача
 * без проекта (личный инбокс) и задача проекта, который набор не выбирал.
 */
export async function getDefaultStatus(orgId: string, setId?: string | null): Promise<TaskStatus | null> {
  const row = setId
    ? await prepare<TaskStatus>(
        `SELECT ${STATUS_SELECT} FROM core.task_statuses WHERE set_id = ?
         ORDER BY is_default DESC, position, created_at LIMIT 1`,
      ).get(setId)
    : await prepare<TaskStatus>(
        `SELECT s.${STATUS_SELECT.split(", ").join(", s.")} FROM core.task_statuses s
         JOIN core.status_sets ss ON ss.id = s.set_id AND ss.is_default
         WHERE s.org_id = ?
         ORDER BY s.is_default DESC, s.position, s.created_at LIMIT 1`,
      ).get(orgId);
  if (row) return row;
  // Набор мог остаться без статусов (или строка приехала от старого кода без
  // set_id) — организация всё равно обязана уметь завести задачу.
  return (
    (await prepare<TaskStatus>(
      `SELECT ${STATUS_SELECT} FROM core.task_statuses WHERE org_id = ?
       ORDER BY is_default DESC, position, created_at LIMIT 1`,
    ).get(orgId)) ?? null
  );
}

/** Набор статусов проекта; `null` у проекта означает набор организации. */
export async function resolveStatusSetId(orgId: string, projectId?: string | null): Promise<string | null> {
  if (projectId) {
    const row = await prepare<{ status_set_id: string | null }>(
      `SELECT status_set_id FROM core.projects WHERE id = ? AND org_id = ?`,
    ).get(projectId, orgId);
    if (row?.status_set_id) return row.status_set_id;
  }
  const fallback = await prepare<{ id: string }>(
    `SELECT id FROM core.status_sets WHERE org_id = ? AND is_default LIMIT 1`,
  ).get(orgId);
  return fallback?.id ?? null;
}

// --- Наборы статусов ---------------------------------------------------------------

/** Состав нового набора: шаблон рабочего процесса под задачи разработки. */
const DEV_SET_TEMPLATE: Array<[string, string, StatusCategory, boolean]> = [
  ["К работе", "#6b7280", "backlog", true],
  ["В работе", "#f59e0b", "in_progress", false],
  ["Code review", "#8b5cf6", "in_progress", false],
  ["QA", "#3b82f6", "in_progress", false],
  ["Готово к релизу", "#14b8a6", "in_progress", false],
  ["Готово", "#10b981", "done", false],
  ["Архив", "#9ca3af", "archived", false],
];

/** Базовый набор — то же, чем сидируется новая организация. */
const BASE_SET_TEMPLATE: Array<[string, string, StatusCategory, boolean]> = [
  ["Входящие", "#6b7280", "backlog", false],
  ["К выполнению", "#3b82f6", "backlog", true],
  ["В работе", "#f59e0b", "in_progress", false],
  ["Готово", "#10b981", "done", false],
  ["Архив", "#9ca3af", "archived", false],
];

export async function listStatusSets(ctx: AuthContext): Promise<StatusSet[]> {
  return prepare<StatusSet>(
    `SELECT id, org_id, name, is_default, created_at, updated_at FROM core.status_sets
     WHERE org_id = ? ORDER BY is_default DESC, created_at`,
  ).all(ctx.orgId);
}

/**
 * Новый набор рождается непустым: пустой набор нарушал бы инвариант «в
 * обязательных категориях есть хотя бы один статус», и первый же проект,
 * выбравший его, остался бы без статуса для новой задачи.
 */
export async function createStatusSet(
  ctx: AuthContext,
  input: { name: string; template?: "dev" | "base" },
): Promise<StatusSet> {
  assertOrg(ctx, "statuses.manage");
  const template = input.template === "base" ? BASE_SET_TEMPLATE : DEV_SET_TEMPLATE;
  return transaction(async (t) => {
    const set = await t
      .prepare<StatusSet>(
        `INSERT INTO core.status_sets (org_id, name) VALUES (?, ?)
         RETURNING id, org_id, name, is_default, created_at, updated_at`,
      )
      .get(ctx.orgId, input.name.trim());
    if (!set) throw new DomainError(500, "Failed to create status set");
    for (let i = 0; i < template.length; i++) {
      const [name, color, category, isDefault] = template[i];
      await t
        .prepare(
          `INSERT INTO core.task_statuses (org_id, set_id, name, color, category, is_default, position)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(ctx.orgId, set.id, name, color, category, isDefault, i + 1);
    }
    return set;
  });
}

export async function updateStatusSet(
  ctx: AuthContext,
  setId: string,
  patch: { name?: string },
): Promise<StatusSet> {
  assertOrg(ctx, "statuses.manage");
  const row = await prepare<StatusSet>(
    `UPDATE core.status_sets SET name = COALESCE(?, name) WHERE id = ? AND org_id = ?
     RETURNING id, org_id, name, is_default, created_at, updated_at`,
  ).get(patch.name?.trim() ?? null, setId, ctx.orgId);
  if (!row) throw new DomainError(404, "Status set not found");
  return row;
}

/**
 * Удаление набора. Набор по умолчанию не удаляем — в него встают проекты без
 * своего выбора. Задачи со статусами удаляемого набора переезжают на статус той
 * же категории из набора по умолчанию: остаться без статуса задача не может, а
 * категория — то, чем статус и определяется для всей остальной логики.
 */
export async function deleteStatusSet(ctx: AuthContext, setId: string): Promise<void> {
  assertOrg(ctx, "statuses.manage");
  const set = await prepare<StatusSet>(
    `SELECT id, org_id, name, is_default, created_at, updated_at FROM core.status_sets
     WHERE id = ? AND org_id = ?`,
  ).get(setId, ctx.orgId);
  if (!set) throw new DomainError(404, "Status set not found");
  if (set.is_default) throw new DomainError(422, "Набор по умолчанию удалить нельзя");

  const fallbackId = await resolveStatusSetId(ctx.orgId, null);
  if (!fallbackId) throw new DomainError(422, "В организации нет набора по умолчанию");
  const fallback = await statusesOfSet(fallbackId);

  await transaction(async (t) => {
    for (const category of STATUS_CATEGORIES) {
      const target =
        fallback.find((s) => s.category === category) ?? fallback.find((s) => s.is_default) ?? fallback[0];
      if (!target) continue;
      await t
        .prepare(
          `UPDATE core.tasks SET status_id = ?
            WHERE org_id = ? AND status_id IN (
              SELECT id FROM core.task_statuses WHERE set_id = ? AND category = ?
            )`,
        )
        .run(target.id, ctx.orgId, setId, category);
    }
    // Проекты возвращаются к набору организации (FK on delete set null сделал бы
    // то же, но явный UPDATE читается однозначно).
    await t.prepare(`UPDATE core.projects SET status_set_id = NULL WHERE status_set_id = ?`).run(setId);
    await t.prepare(`DELETE FROM core.status_sets WHERE id = ? AND org_id = ?`).run(setId, ctx.orgId);
  });
}

export async function createStatus(
  ctx: AuthContext,
  input: { name: string; color?: string; category?: StatusCategory; set_id?: string | null },
): Promise<TaskStatus> {
  assertOrg(ctx, "statuses.manage");
  const category = input.category ?? "backlog";
  // Набор не назван — значит основной: так справочник ведёт себя ровно как до
  // появления наборов.
  const setId = input.set_id ?? (await resolveStatusSetId(ctx.orgId, null));
  if (!setId) throw new DomainError(422, "В организации нет набора статусов");
  return transaction(async (t) => {
    // Новый статус встаёт в конец СВОЕЙ категории, а не всего справочника:
    // `max(position) + 1` по набору уводил его за архивные, и выпадающие
    // списки показывали «Архив» посреди рабочих статусов (см. 0045).
    const row = await t
      .prepare<TaskStatus>(
        `INSERT INTO core.task_statuses (org_id, set_id, name, color, category, position)
         VALUES (?, ?, ?, ?, ?,
                 COALESCE((SELECT max(position) FROM core.task_statuses WHERE set_id = ? AND category = ?),
                          (SELECT max(position) FROM core.task_statuses WHERE set_id = ?),
                          0) + 0.5)
         RETURNING ${STATUS_SELECT}`,
      )
      .get(
        ctx.orgId,
        setId,
        input.name,
        input.color ?? "#6b7280",
        category,
        setId,
        category,
        setId,
      );
    if (!row) throw new DomainError(500, "Failed to create status");
    // Дробная позиция — только чтобы встать между соседями; сразу за вставкой
    // нумерация выравнивается, иначе дроби копились бы с каждым статусом.
    await renumber(t, setId);
    const fresh = await t
      .prepare<TaskStatus>(`SELECT ${STATUS_SELECT} FROM core.task_statuses WHERE id = ?`)
      .get(row.id);
    return fresh ?? row;
  });
}

/**
 * Позиции 1..N в порядке категорий — инвариант справочника после любой правки.
 * Считается внутри набора: у каждого набора свой ряд, и общая нумерация по
 * организации перемешала бы «бэклог» одного с «архивом» другого.
 */
async function renumber(t: TxContext, setId: string): Promise<void> {
  await t
    .prepare(
      `WITH ranked AS (
         SELECT id, row_number() OVER (ORDER BY ${STATUS_ORDER}) AS rn
           FROM core.task_statuses WHERE set_id = ?
       )
       UPDATE core.task_statuses s SET position = ranked.rn
         FROM ranked
        WHERE ranked.id = s.id AND s.position IS DISTINCT FROM ranked.rn`,
    )
    .run(setId);
}

export async function updateStatus(
  ctx: AuthContext,
  statusId: string,
  patch: Partial<{ name: string; color: string; category: StatusCategory; position: number }> & {
    is_default?: true;
  },
): Promise<TaskStatus> {
  assertOrg(ctx, "statuses.manage");
  const target = await prepare<TaskStatus>(
    `SELECT ${STATUS_SELECT} FROM core.task_statuses WHERE id = ? AND org_id = ?`,
  ).get(statusId, ctx.orgId);
  if (!target) throw new DomainError(404, "Status not found");
  // Инварианты считаются по набору, а не по организации: «последний в
  // категории» — это последний в СВОЁМ наборе, у соседнего свой ряд.
  const all = await statusesOfSet(target.set_id);
  const current = all.find((s) => s.id === statusId);
  if (!current) throw new DomainError(404, "Status not found");

  const nextCategory = patch.category ?? current.category;
  // Проверяем до UPDATE: CHECK в базе отдал бы 23514 вместо внятного текста.
  const moveBlock = statusMoveBlock(all, statusId, nextCategory);
  if (moveBlock) throw new DomainError(422, moveBlockMessage(moveBlock, current.category));
  if (patch.is_default && !isWorkingCategory(nextCategory)) {
    throw new DomainError(422, "По умолчанию можно назначить только статус из «Бэклога» или «В работе»");
  }

  const next = { ...current, ...patch, category: nextCategory };
  const becameDone = nextCategory === "done" && current.category !== "done";
  const leftDone = current.category === "done" && nextCategory !== "done";

  return transaction(async (t) => {
    // Категория идёт ПЕРВОЙ: CHECK разрешает дефолт только рабочей категории, и
    // совместный патч {category: 'backlog', is_default: true} на завершающем
    // статусе падал бы на 23514, если сначала выставить флаг.
    await t
      .prepare(
        `UPDATE core.task_statuses SET name = ?, color = ?, category = ?, position = ? WHERE id = ?`,
      )
      .run(next.name, next.color, next.category, next.position, statusId);

    // Отметка о завершении выводится из категории, поэтому смена категории
    // обязана пересчитать её у задач в этом статусе — иначе задачи в статусе,
    // переехавшем в «Завершено», остаются незавершёнными везде, кроме названия
    // категории (и наоборот). Так же поступает deleteStatus при переносе задач.
    if (becameDone || leftDone) {
      await t
        .prepare(
          `UPDATE core.tasks
              SET completed_at = CASE WHEN ?::boolean THEN COALESCE(completed_at, now()) ELSE NULL END
            WHERE org_id = ? AND status_id = ?`,
        )
        .run(becameDone, ctx.orgId, statusId);
    }

    if (patch.is_default && !current.is_default) {
      // Двумя шагами, а не одним UPDATE по набору: частичный уникальный индекс
      // не откладываемый, и промежуточное состояние с двумя дефолтами упало бы
      // прямо посреди запроса.
      await t.prepare(`UPDATE core.task_statuses SET is_default = false WHERE set_id = ? AND is_default`).run(
        current.set_id,
      );
      await t.prepare(`UPDATE core.task_statuses SET is_default = true WHERE id = ? AND org_id = ?`).run(
        statusId,
        ctx.orgId,
      );
    }

    // Патч категории двигает статус в другой блок справочника — нумерация обязана
    // это отразить, иначе он останется в списках на прежнем месте.
    if (nextCategory !== current.category) await renumber(t, current.set_id);

    const row = await t
      .prepare<TaskStatus>(`SELECT ${STATUS_SELECT} FROM core.task_statuses WHERE id = ?`)
      .get(statusId);
    if (!row) throw new DomainError(500, "Failed to update status");
    return row;
  });
}

/**
 * Новый порядок справочника целиком: одним запросом и одной транзакцией, потому
 * что перетаскивание статуса сдвигает соседей, а перенос в другую категорию
 * проверяется по всей раскладке сразу. Позиции нормализуются в 1..N — глобальный
 * порядок обязан совпадать с порядком категорий, иначе ряд кнопок в карточке
 * (`cardStatuses` идёт по позиции) начнёт перемешивать «бэклог» и «в работе».
 */
export async function reorderStatuses(
  ctx: AuthContext,
  order: Array<{ id: string; category: StatusCategory }>,
  opts: { set_id?: string | null } = {},
): Promise<TaskStatus[]> {
  assertOrg(ctx, "statuses.manage");
  // Набор берём из первого статуса порядка: перетаскивание идёт внутри одной
  // вкладки настроек, и перечислять его отдельно вызывающему незачем.
  const setId =
    opts.set_id ??
    (order[0]
      ? (
          await prepare<{ set_id: string }>(
            `SELECT set_id FROM core.task_statuses WHERE id = ? AND org_id = ?`,
          ).get(order[0].id, ctx.orgId)
        )?.set_id ?? null
      : null);
  if (!setId) throw new DomainError(422, "Не удалось определить набор статусов");
  const all = await statusesOfSet(setId);
  const byId = new Map(all.map((s) => [s.id, s]));
  // Порядок приходит целиком: частичный список молча увёл бы неупомянутые
  // статусы в начало справочника.
  const unique = new Set(order.map((o) => o.id));
  if (order.length !== all.length || unique.size !== order.length || order.some((o) => !byId.has(o.id))) {
    throw new DomainError(422, "Порядок должен перечислять все статусы набора по одному разу");
  }

  const next = order.map((o, i) => ({ ...byId.get(o.id)!, category: o.category, position: i + 1 }));
  const invalid = arrangementError(next);
  if (invalid) throw new DomainError(422, invalid);

  return transaction(async (t) => {
    for (const row of next) {
      const before = byId.get(row.id)!;
      if (before.category === row.category && before.position === row.position) continue;
      await t
        .prepare(`UPDATE core.task_statuses SET category = ?, position = ? WHERE id = ? AND org_id = ?`)
        .run(row.category, row.position, row.id, ctx.orgId);

      // Как и в updateStatus: отметка о завершении выводится из категории, и
      // статус, переехавший в «Завершено» (или из него), обязан пересчитать её у
      // своих задач. Событий на задачи не пишем — правка справочника не должна
      // оборачиваться лавиной в ленте и push.
      const becameDone = row.category === "done" && before.category !== "done";
      const leftDone = before.category === "done" && row.category !== "done";
      if (becameDone || leftDone) {
        await t
          .prepare(
            `UPDATE core.tasks
                SET completed_at = CASE WHEN ?::boolean THEN COALESCE(completed_at, now()) ELSE NULL END
              WHERE org_id = ? AND status_id = ?`,
          )
          .run(becameDone, ctx.orgId, row.id);
      }
    }
    // Порядок внутри категории — как прислали, а сами категории всегда идут
    // своей чередой: запрос, перемешавший их между собой, выравнивается здесь.
    await renumber(t, setId);
    return t
      .prepare<TaskStatus>(
        `SELECT ${STATUS_SELECT} FROM core.task_statuses WHERE org_id = ? ORDER BY ${STATUS_ORDER}`,
      )
      .all(ctx.orgId);
  });
}

export async function deleteStatus(ctx: AuthContext, statusId: string): Promise<void> {
  assertOrg(ctx, "statuses.manage");
  const row = await prepare<TaskStatus>(
    `SELECT ${STATUS_SELECT} FROM core.task_statuses WHERE id = ? AND org_id = ?`,
  ).get(statusId, ctx.orgId);
  if (!row) throw new DomainError(404, "Status not found");
  const all = await statusesOfSet(row.set_id);
  const target = all.find((s) => s.id === statusId);
  if (!target) throw new DomainError(404, "Status not found");

  const block = statusDeleteBlock(all, statusId);
  if (block) throw new DomainError(422, deleteBlockMessage(block, target.category));

  // Соседа ищем в своём наборе: задача, уехавшая в статус чужого рабочего
  // процесса, пропала бы из колонок своего проекта.
  const fallbackId = fallbackStatusId(all, statusId);
  if (!fallbackId) throw new DomainError(422, "Удалить последний статус набора нельзя");
  const fallbackDone = all.find((s) => s.id === fallbackId)?.category === "done";

  await transaction(async (t) => {
    // Задачи переезжают явно: FK `on delete set null` оставил бы их без статуса,
    // а пустого статуса у задачи больше не бывает. Событий на задачу не пишем —
    // правка справочника не должна превращаться в лавину в ленте и в push.
    await t
      .prepare(
        `UPDATE core.tasks
            SET status_id = ?,
                completed_at = CASE WHEN ?::boolean THEN COALESCE(completed_at, now()) ELSE NULL END
          WHERE org_id = ? AND status_id = ?`,
      )
      .run(fallbackId, fallbackDone, ctx.orgId, statusId);
    await t.prepare(`DELETE FROM core.task_statuses WHERE id = ? AND org_id = ?`).run(statusId, ctx.orgId);
    // Дыра в нумерации порядок не ломает, но следующая вставка в эту категорию
    // считает позицию от максимума — держим 1..N без пропусков.
    await renumber(t, row.set_id);
  });
}

// --- Теги --------------------------------------------------------------------------

export async function listTags(ctx: AuthContext): Promise<CoreTag[]> {
  return prepare<CoreTag>(
    `SELECT id, org_id, name, color, position FROM core.tags WHERE org_id = ? ORDER BY position, name`,
  ).all(ctx.orgId);
}

export async function createTag(ctx: AuthContext, input: { name: string; color?: string }): Promise<CoreTag> {
  assertOrg(ctx, "tags.manage");
  const existing = await prepare<CoreTag>(
    `SELECT id, org_id, name, color, position FROM core.tags WHERE org_id = ? AND name = ?`,
  ).get(ctx.orgId, input.name);
  if (existing) throw new DomainError(409, "Tag with this name already exists");
  const row = await prepare<CoreTag>(
    `INSERT INTO core.tags (org_id, name, color, position)
     VALUES (?, ?, ?, COALESCE((SELECT max(position) + 1 FROM core.tags WHERE org_id = ?), 1))
     RETURNING id, org_id, name, color, position`,
  ).get(ctx.orgId, input.name, input.color ?? "#6b7280", ctx.orgId);
  if (!row) throw new DomainError(500, "Failed to create tag");
  return row;
}

export async function updateTag(
  ctx: AuthContext,
  tagId: string,
  patch: Partial<{ name: string; color: string; position: number }>,
): Promise<CoreTag> {
  assertOrg(ctx, "tags.manage");
  const current = await prepare<CoreTag>(
    `SELECT id, org_id, name, color, position FROM core.tags WHERE id = ? AND org_id = ?`,
  ).get(tagId, ctx.orgId);
  if (!current) throw new DomainError(404, "Tag not found");
  const next = { ...current, ...patch };
  const row = await prepare<CoreTag>(
    `UPDATE core.tags SET name = ?, color = ?, position = ? WHERE id = ?
     RETURNING id, org_id, name, color, position`,
  ).get(next.name, next.color, next.position, tagId);
  if (!row) throw new DomainError(500, "Failed to update tag");
  return row;
}

export async function deleteTag(ctx: AuthContext, tagId: string): Promise<void> {
  assertOrg(ctx, "tags.manage");
  const changed = await prepare(`DELETE FROM core.tags WHERE id = ? AND org_id = ?`).run(tagId, ctx.orgId);
  if (changed.changes === 0) throw new DomainError(404, "Tag not found");
}
