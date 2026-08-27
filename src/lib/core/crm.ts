// Доменный сервис CRM: воронки, этапы, сделки, история этапов.
//
// Сделка — центр модели: она едет по этапам воронки, а клиент остаётся
// аккаунтом с историей сделок. Статус сделки не хранится — он выводится из вида
// (`kind`) её этапа; правила, которые повторяет интерфейс, живут в чистой
// `crm-model.ts`.

import { prepare, transaction, type TxContext } from "@/lib/sql";
import { emitEvent } from "./events";
import { DomainError } from "./http";
import { assertOrg } from "./policy";
import {
  fallbackStageId,
  intakeStage,
  isClosedKind,
  stageDeleteBlock,
  stageDeleteMessage,
  templateStages,
  type StageKind,
} from "./crm-model";
import type { AuthContext } from "./types";

// --- Типы --------------------------------------------------------------------

export interface Pipeline {
  id: string;
  org_id: string;
  name: string;
  is_default: boolean;
  /** Воронка без денег считает сделки в штуках: суммы в интерфейсе скрыты. */
  track_amounts: boolean;
  position: number;
  created_at: string;
  updated_at: string;
}

export interface PipelineStage {
  id: string;
  org_id: string;
  pipeline_id: string;
  name: string;
  color: string;
  kind: StageKind;
  probability: number;
  position: number;
  archived_at: string | null;
}

export interface LeadSource {
  id: string;
  org_id: string;
  name: string;
  color: string;
  position: number;
}

export interface LostReason {
  id: string;
  org_id: string;
  name: string;
  position: number;
}

export interface Deal {
  id: string;
  org_id: string;
  pipeline_id: string;
  stage_id: string;
  title: string;
  amount: number | null;
  client_id: string | null;
  assignee_id: string | null;
  contact_name: string;
  contact_phone: string;
  contact_email: string;
  contact_telegram: string;
  source_id: string | null;
  utm_source: string;
  utm_medium: string;
  utm_campaign: string;
  utm_term: string;
  utm_content: string;
  referrer: string;
  landing_page: string;
  lost_reason_id: string | null;
  closed_at: string | null;
  position: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

/** Строка списка: сделка плюс то, что рисует карточка на доске. */
export interface DealRow extends Deal {
  client_name: string | null;
  assignee_name: string | null;
  source_name: string | null;
  source_color: string | null;
  /** Когда сделка вошла в текущий этап — из неё считается «N дней на этапе». */
  stage_entered_at: string | null;
}

export interface DealHistoryEntry {
  id: number;
  stage_id: string;
  stage_name: string;
  actor_name: string | null;
  entered_at: string;
}

export interface CrmMeta {
  pipelines: Pipeline[];
  stages: PipelineStage[];
  sources: LeadSource[];
  lost_reasons: LostReason[];
}

/**
 * `amount` — numeric, и postgres.js отдаёт его строкой (точность денег дороже
 * удобства). Список и карточка объявлены с number, поэтому приводим на выходе:
 * иначе сортировка на клиенте сравнивала бы «9» > «10».
 */
function normalizeAmount<T extends { amount: unknown }>(row: T): T {
  return { ...row, amount: row.amount === null || row.amount === undefined ? null : Number(row.amount) };
}

// --- Справочники ---------------------------------------------------------------

export async function listCrmMeta(ctx: AuthContext): Promise<CrmMeta> {
  assertOrg(ctx, "crm.view");
  const [pipelines, stages, sources, lost_reasons] = await Promise.all([
    prepare<Pipeline>(
      `SELECT id, org_id, name, is_default, track_amounts, position, created_at, updated_at
         FROM core.pipelines WHERE org_id = ? ORDER BY position, created_at`,
    ).all(ctx.orgId),
    prepare<PipelineStage>(
      `SELECT id, org_id, pipeline_id, name, color, kind, probability, position, archived_at
         FROM core.pipeline_stages WHERE org_id = ? ORDER BY position, created_at`,
    ).all(ctx.orgId),
    prepare<LeadSource>(
      `SELECT id, org_id, name, color, position FROM core.lead_sources
        WHERE org_id = ? ORDER BY position, name`,
    ).all(ctx.orgId),
    prepare<LostReason>(
      `SELECT id, org_id, name, position FROM core.lost_reasons
        WHERE org_id = ? ORDER BY position, name`,
    ).all(ctx.orgId),
  ]);
  return { pipelines, stages, sources, lost_reasons };
}

export async function createLeadSource(
  ctx: AuthContext,
  input: { name: string; color?: string },
): Promise<LeadSource> {
  assertOrg(ctx, "crm.manage");
  const row = await prepare<LeadSource>(
    `INSERT INTO core.lead_sources (org_id, name, color, position)
     VALUES (?, ?, ?, COALESCE((SELECT max(position) + 1 FROM core.lead_sources WHERE org_id = ?), 1))
     ON CONFLICT (org_id, name) DO UPDATE SET name = excluded.name
     RETURNING id, org_id, name, color, position`,
  ).get(ctx.orgId, input.name.trim(), input.color ?? "#6b7280", ctx.orgId);
  if (!row) throw new DomainError(500, "Не удалось создать источник");
  return row;
}

export async function createLostReason(
  ctx: AuthContext,
  input: { name: string },
): Promise<LostReason> {
  assertOrg(ctx, "crm.manage");
  const row = await prepare<LostReason>(
    `INSERT INTO core.lost_reasons (org_id, name, position)
     VALUES (?, ?, COALESCE((SELECT max(position) + 1 FROM core.lost_reasons WHERE org_id = ?), 1))
     ON CONFLICT (org_id, name) DO UPDATE SET name = excluded.name
     RETURNING id, org_id, name, position`,
  ).get(ctx.orgId, input.name.trim(), ctx.orgId);
  if (!row) throw new DomainError(500, "Не удалось создать причину");
  return row;
}

// --- Воронки --------------------------------------------------------------------

async function requirePipeline(ctx: AuthContext, pipelineId: string): Promise<Pipeline> {
  const row = await prepare<Pipeline>(
    `SELECT id, org_id, name, is_default, track_amounts, position, created_at, updated_at
       FROM core.pipelines WHERE id = ?`,
  ).get(pipelineId);
  if (!row || row.org_id !== ctx.orgId) throw new DomainError(404, "Воронка не найдена");
  return row;
}

/**
 * Новая воронка рождается непустой — из шаблона. Пустая не приняла бы ни одной
 * сделки, а без итоговых этапов не считается ни одна конверсия.
 */
export async function createPipeline(
  ctx: AuthContext,
  input: { name: string; template?: string; track_amounts?: boolean },
): Promise<{ pipeline: Pipeline; stages: PipelineStage[] }> {
  assertOrg(ctx, "crm.configure");
  const stages = templateStages(input.template ?? "sales");

  return transaction(async (tx) => {
    const pipeline = await tx
      .prepare<Pipeline>(
        `INSERT INTO core.pipelines (org_id, name, track_amounts, position, created_by)
         VALUES (?, ?, ?, COALESCE((SELECT max(position) + 1 FROM core.pipelines WHERE org_id = ?), 1), ?)
         RETURNING id, org_id, name, is_default, track_amounts, position, created_at, updated_at`,
      )
      .get(ctx.orgId, input.name.trim(), input.track_amounts ?? true, ctx.orgId, ctx.user.id);
    if (!pipeline) throw new DomainError(500, "Не удалось создать воронку");

    const created: PipelineStage[] = [];
    for (const [i, s] of stages.entries()) {
      const row = await tx
        .prepare<PipelineStage>(
          `INSERT INTO core.pipeline_stages (org_id, pipeline_id, name, color, kind, probability, position)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           RETURNING id, org_id, pipeline_id, name, color, kind, probability, position, archived_at`,
        )
        .get(ctx.orgId, pipeline.id, s.name, s.color, s.kind, s.probability, i + 1);
      if (row) created.push(row);
    }

    await emitEvent(tx, {
      orgId: ctx.orgId,
      actorId: ctx.user.id,
      entityType: "org",
      entityId: ctx.orgId,
      verb: "pipeline.created",
      payload: { pipeline_id: pipeline.id, name: pipeline.name },
    });
    return { pipeline, stages: created };
  });
}

export async function updatePipeline(
  ctx: AuthContext,
  pipelineId: string,
  patch: { name?: string; track_amounts?: boolean; is_default?: boolean },
): Promise<Pipeline> {
  assertOrg(ctx, "crm.configure");
  const pipeline = await requirePipeline(ctx, pipelineId);

  return transaction(async (tx) => {
    // Дефолт переназначается двумя стейтментами: частичный уникальный индекс не
    // откладываемый, и одним UPDATE по организации ловится транзиентное
    // нарушение уникальности (тот же приём, что у статуса по умолчанию).
    if (patch.is_default) {
      await tx
        .prepare(`UPDATE core.pipelines SET is_default = false WHERE org_id = ? AND is_default`)
        .run(ctx.orgId);
    }
    const row = await tx
      .prepare<Pipeline>(
        `UPDATE core.pipelines SET name = ?, track_amounts = ?, is_default = ?
          WHERE id = ?
        RETURNING id, org_id, name, is_default, track_amounts, position, created_at, updated_at`,
      )
      .get(
        patch.name !== undefined ? patch.name.trim() : pipeline.name,
        patch.track_amounts !== undefined ? patch.track_amounts : pipeline.track_amounts,
        patch.is_default !== undefined ? patch.is_default : pipeline.is_default,
        pipelineId,
      );
    if (!row) throw new DomainError(500, "Не удалось сохранить воронку");
    return row;
  });
}

/**
 * Удаление воронки. Сделки не пропадают молча: если они есть, вызывающий обязан
 * назвать воронку-приёмник — иначе история продаж исчезла бы вместе с отчётами.
 */
export async function deletePipeline(
  ctx: AuthContext,
  pipelineId: string,
  moveToPipelineId?: string | null,
): Promise<void> {
  assertOrg(ctx, "crm.configure");
  const pipeline = await requirePipeline(ctx, pipelineId);
  const total = await prepare<{ count: number }>(
    `SELECT count(*)::int AS count FROM core.pipelines WHERE org_id = ?`,
  ).get(ctx.orgId);
  if ((total?.count ?? 0) <= 1) {
    throw new DomainError(422, "Последнюю воронку удалить нельзя");
  }
  const deals = await prepare<{ count: number }>(
    `SELECT count(*)::int AS count FROM core.deals WHERE pipeline_id = ?`,
  ).get(pipelineId);

  await transaction(async (tx) => {
    if ((deals?.count ?? 0) > 0) {
      if (!moveToPipelineId) {
        throw new DomainError(422, `В воронке ${deals?.count} сделок — укажите, куда их перенести`);
      }
      const target = await requirePipeline(ctx, moveToPipelineId);
      const stage = await tx
        .prepare<PipelineStage>(
          `SELECT id, org_id, pipeline_id, name, color, kind, probability, position, archived_at
             FROM core.pipeline_stages
            WHERE pipeline_id = ? AND kind = 'open' AND archived_at IS NULL
            ORDER BY position LIMIT 1`,
        )
        .get(target.id);
      if (!stage) throw new DomainError(422, "В целевой воронке нет рабочего этапа");
      await tx
        .prepare(`UPDATE core.deals SET pipeline_id = ?, stage_id = ? WHERE pipeline_id = ?`)
        .run(target.id, stage.id, pipelineId);
      // История остаётся как есть: она описывает то, что действительно было.
    }
    await tx.prepare(`DELETE FROM core.pipelines WHERE id = ?`).run(pipelineId);
    await emitEvent(tx, {
      orgId: ctx.orgId,
      actorId: ctx.user.id,
      entityType: "org",
      entityId: ctx.orgId,
      verb: "pipeline.deleted",
      payload: { pipeline_id: pipelineId, name: pipeline.name },
    });
  });
}

// --- Этапы ------------------------------------------------------------------------

async function stagesOfPipeline(pipelineId: string): Promise<PipelineStage[]> {
  return prepare<PipelineStage>(
    `SELECT id, org_id, pipeline_id, name, color, kind, probability, position, archived_at
       FROM core.pipeline_stages WHERE pipeline_id = ? ORDER BY position`,
  ).all(pipelineId);
}

export async function createStage(
  ctx: AuthContext,
  pipelineId: string,
  input: { name: string; color?: string; probability?: number },
): Promise<PipelineStage> {
  assertOrg(ctx, "crm.configure");
  await requirePipeline(ctx, pipelineId);
  // Новый рабочий этап встаёт МЕЖДУ последним рабочим и первым итоговым: за
  // «Выиграно» этапов не бывает. Позиция — double precision ровно ради этого:
  // середина промежутка не задевает соседей и не требует пересчёта справочника.
  // Брать `min(итоговых) - 1` нельзя: у плотно уложенных позиций (1,2,3) это
  // совпадает с позицией предыдущего этапа, и порядок становится случайным.
  const row = await prepare<PipelineStage>(
    `INSERT INTO core.pipeline_stages (org_id, pipeline_id, name, color, kind, probability, position)
     VALUES (?, ?, ?, ?, 'open', ?,
             COALESCE(
               (SELECT (max(o.position) + min(t.position)) / 2
                  FROM core.pipeline_stages o, core.pipeline_stages t
                 WHERE o.pipeline_id = ? AND o.kind = 'open' AND o.archived_at IS NULL
                   AND t.pipeline_id = ? AND t.kind <> 'open' AND t.archived_at IS NULL),
               COALESCE((SELECT max(position) + 1 FROM core.pipeline_stages WHERE pipeline_id = ?), 1)))
     RETURNING id, org_id, pipeline_id, name, color, kind, probability, position, archived_at`,
  ).get(
    ctx.orgId,
    pipelineId,
    input.name.trim(),
    input.color ?? "#6b7280",
    input.probability ?? 0,
    pipelineId,
    pipelineId,
    pipelineId,
  );
  if (!row) throw new DomainError(500, "Не удалось создать этап");
  return row;
}

export async function updateStage(
  ctx: AuthContext,
  stageId: string,
  patch: { name?: string; color?: string; probability?: number },
): Promise<PipelineStage> {
  assertOrg(ctx, "crm.configure");
  const stage = await prepare<PipelineStage>(
    `SELECT id, org_id, pipeline_id, name, color, kind, probability, position, archived_at
       FROM core.pipeline_stages WHERE id = ?`,
  ).get(stageId);
  if (!stage || stage.org_id !== ctx.orgId) throw new DomainError(404, "Этап не найден");

  const row = await prepare<PipelineStage>(
    `UPDATE core.pipeline_stages SET name = ?, color = ?, probability = ? WHERE id = ?
     RETURNING id, org_id, pipeline_id, name, color, kind, probability, position, archived_at`,
  ).get(
    patch.name !== undefined ? patch.name.trim() : stage.name,
    patch.color ?? stage.color,
    patch.probability !== undefined ? patch.probability : stage.probability,
    stageId,
  );
  if (!row) throw new DomainError(500, "Не удалось сохранить этап");
  return row;
}

/**
 * Удаление этапа — мягкое. `deal_stage_history` ссылается на этап, и жёсткое
 * удаление выбило бы строку из отчёта за прошлый период: воронка за июль
 * перестала бы сходиться задним числом.
 */
export async function deleteStage(ctx: AuthContext, stageId: string): Promise<void> {
  assertOrg(ctx, "crm.configure");
  const stage = await prepare<PipelineStage>(
    `SELECT id, org_id, pipeline_id, name, color, kind, probability, position, archived_at
       FROM core.pipeline_stages WHERE id = ?`,
  ).get(stageId);
  if (!stage || stage.org_id !== ctx.orgId) throw new DomainError(404, "Этап не найден");

  const stages = await stagesOfPipeline(stage.pipeline_id);
  const block = stageDeleteBlock(stages, stageId);
  if (block) throw new DomainError(422, stageDeleteMessage(block));

  const fallback = fallbackStageId(stages, stageId);
  if (!fallback) throw new DomainError(422, "Сделки этапа некуда перенести");

  await transaction(async (tx) => {
    await tx.prepare(`UPDATE core.deals SET stage_id = ? WHERE stage_id = ?`).run(fallback, stageId);
    await tx
      .prepare(`UPDATE core.pipeline_stages SET archived_at = now() WHERE id = ?`)
      .run(stageId);
  });
}

/**
 * Порядок этапов приходит целиком — как порядок статусов (16в в CLAUDE.md):
 * перетаскивание сдвигает соседей, и патч одной позиции оставил бы воронку в
 * промежуточном состоянии между запросами.
 */
export async function reorderStages(
  ctx: AuthContext,
  pipelineId: string,
  stageIds: string[],
): Promise<PipelineStage[]> {
  assertOrg(ctx, "crm.configure");
  await requirePipeline(ctx, pipelineId);
  const stages = await stagesOfPipeline(pipelineId);
  const live = stages.filter((s) => !s.archived_at);
  if (stageIds.length !== live.length || new Set(stageIds).size !== stageIds.length) {
    throw new DomainError(422, "Порядок должен перечислять все этапы воронки по одному разу");
  }
  const known = new Set(live.map((s) => s.id));
  if (stageIds.some((id) => !known.has(id))) {
    throw new DomainError(422, "В порядке есть этап из другой воронки");
  }

  await transaction(async (tx) => {
    for (const [i, id] of stageIds.entries()) {
      await tx.prepare(`UPDATE core.pipeline_stages SET position = ? WHERE id = ?`).run(i + 1, id);
    }
  });
  return stagesOfPipeline(pipelineId);
}

// --- Сделки -------------------------------------------------------------------------

const DEAL_ROW_SELECT = `
  SELECT d.*,
         c.name AS client_name,
         u.name AS assignee_name,
         ls.name AS source_name,
         ls.color AS source_color,
         (SELECT max(h.entered_at) FROM core.deal_stage_history h
           WHERE h.deal_id = d.id AND h.stage_id = d.stage_id) AS stage_entered_at
    FROM core.deals d
    LEFT JOIN core.clients c ON c.id = d.client_id
    LEFT JOIN core.users u ON u.id = d.assignee_id
    LEFT JOIN core.lead_sources ls ON ls.id = d.source_id`;

export interface ListDealsOptions {
  pipelineId?: string;
  /** Показывать закрытые (выигранные и проигранные). По умолчанию — да: доска
   *  рисует их в итоговых колонках, а таблица фильтрует сама. */
  includeClosed?: boolean;
  limit?: number;
}

export async function listDeals(ctx: AuthContext, opts: ListDealsOptions = {}): Promise<DealRow[]> {
  assertOrg(ctx, "crm.view");
  const rows = await prepare<DealRow>(
    `${DEAL_ROW_SELECT}
      WHERE d.org_id = ?
        AND (?::uuid IS NULL OR d.pipeline_id = ?::uuid)
        AND (?::boolean OR d.closed_at IS NULL)
      ORDER BY d.position, d.created_at DESC
      LIMIT ?`,
  ).all(
    ctx.orgId,
    opts.pipelineId ?? null,
    opts.pipelineId ?? null,
    opts.includeClosed ?? true,
    opts.limit ?? 500,
  );
  return rows.map(normalizeAmount);
}

export async function getDeal(ctx: AuthContext, dealId: string): Promise<DealRow> {
  assertOrg(ctx, "crm.view");
  const row = await prepare<DealRow>(`${DEAL_ROW_SELECT} WHERE d.id = ? AND d.org_id = ?`).get(
    dealId,
    ctx.orgId,
  );
  if (!row) throw new DomainError(404, "Сделка не найдена");
  return normalizeAmount(row);
}

/** История этапов сделки — из неё же считается «сколько дней на этапе». */
export async function listDealHistory(
  ctx: AuthContext,
  dealId: string,
): Promise<DealHistoryEntry[]> {
  assertOrg(ctx, "crm.view");
  return prepare<DealHistoryEntry>(
    `SELECT h.id, h.stage_id, s.name AS stage_name, u.name AS actor_name, h.entered_at
       FROM core.deal_stage_history h
       JOIN core.pipeline_stages s ON s.id = h.stage_id
       LEFT JOIN core.users u ON u.id = h.actor_id
      WHERE h.deal_id = ? AND h.org_id = ?
      ORDER BY h.entered_at, h.id`,
  ).all(dealId, ctx.orgId);
}

/** Сделки клиента — карточка клиента как аккаунта с историей покупок. */
export async function listClientDeals(ctx: AuthContext, clientId: string): Promise<DealRow[]> {
  assertOrg(ctx, "crm.view");
  const rows = await prepare<DealRow>(
    `${DEAL_ROW_SELECT} WHERE d.client_id = ? AND d.org_id = ? ORDER BY d.created_at DESC`,
  ).all(clientId, ctx.orgId);
  return rows.map(normalizeAmount);
}

export interface DealInput {
  pipeline_id?: string;
  stage_id?: string;
  title?: string;
  amount?: number | null;
  client_id?: string | null;
  assignee_id?: string | null;
  contact_name?: string;
  contact_phone?: string;
  contact_email?: string;
  contact_telegram?: string;
  source_id?: string | null;
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_term?: string;
  utm_content?: string;
  referrer?: string;
  landing_page?: string;
  lost_reason_id?: string | null;
}

async function resolveTargetStage(
  ctx: AuthContext,
  pipelineId: string | undefined,
  stageId: string | undefined,
): Promise<{ pipeline: Pipeline; stage: PipelineStage }> {
  let pipeline: Pipeline | undefined;
  if (pipelineId) {
    pipeline = await requirePipeline(ctx, pipelineId);
  } else {
    pipeline = await prepare<Pipeline>(
      `SELECT id, org_id, name, is_default, track_amounts, position, created_at, updated_at
         FROM core.pipelines WHERE org_id = ? ORDER BY is_default DESC, position LIMIT 1`,
    ).get(ctx.orgId);
  }
  if (!pipeline) throw new DomainError(422, "В организации нет ни одной воронки");

  const stages = await stagesOfPipeline(pipeline.id);
  const stage = stageId
    ? stages.find((s) => s.id === stageId)
    : intakeStage(stages);
  if (!stage) throw new DomainError(422, "Этап не найден в этой воронке");
  return { pipeline, stage };
}

export async function createDeal(ctx: AuthContext, input: DealInput): Promise<DealRow> {
  assertOrg(ctx, "crm.manage");
  const { pipeline, stage } = await resolveTargetStage(ctx, input.pipeline_id, input.stage_id);

  const id = await transaction(async (tx) => {
    const row = await tx
      .prepare<{ id: string }>(
        `INSERT INTO core.deals
           (org_id, pipeline_id, stage_id, title, amount, client_id, assignee_id,
            contact_name, contact_phone, contact_email, contact_telegram, source_id,
            utm_source, utm_medium, utm_campaign, utm_term, utm_content, referrer, landing_page,
            closed_at, position, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                 COALESCE((SELECT max(position) + 1 FROM core.deals WHERE org_id = ? AND stage_id = ?), 1),
                 ?)
         RETURNING id`,
      )
      .get(
        ctx.orgId,
        pipeline.id,
        stage.id,
        (input.title ?? "").trim(),
        input.amount ?? null,
        input.client_id ?? null,
        // Сделка без ответственного остаётся ничьей — по умолчанию отвечает тот,
        // кто её завёл (то же правило, что у исполнителя новой задачи).
        input.assignee_id !== undefined ? input.assignee_id : ctx.user.id,
        input.contact_name ?? "",
        input.contact_phone ?? "",
        input.contact_email ?? "",
        input.contact_telegram ?? "",
        input.source_id ?? null,
        input.utm_source ?? "",
        input.utm_medium ?? "",
        input.utm_campaign ?? "",
        input.utm_term ?? "",
        input.utm_content ?? "",
        input.referrer ?? "",
        input.landing_page ?? "",
        isClosedKind(stage.kind) ? new Date().toISOString() : null,
        ctx.orgId,
        stage.id,
        ctx.user.id,
      );
    if (!row) throw new DomainError(500, "Не удалось создать сделку");

    // Первый вход в этап — такая же строка истории, как и все последующие:
    // иначе у сделки, созданной сразу в «Квалификации», не было бы точки отсчёта.
    await tx
      .prepare(
        `INSERT INTO core.deal_stage_history (org_id, deal_id, stage_id, actor_id)
         VALUES (?, ?, ?, ?)`,
      )
      .run(ctx.orgId, row.id, stage.id, ctx.user.id);

    await emitEvent(tx, {
      orgId: ctx.orgId,
      actorId: ctx.user.id,
      entityType: "deal",
      entityId: row.id,
      verb: "deal.created",
      payload: { title: input.title ?? "", pipeline_id: pipeline.id, stage_id: stage.id },
    });
    return row.id;
  });

  return getDeal(ctx, id);
}

export async function updateDeal(
  ctx: AuthContext,
  dealId: string,
  patch: DealInput,
): Promise<DealRow> {
  assertOrg(ctx, "crm.manage");
  const deal = await getDeal(ctx, dealId);

  // Смена этапа — отдельное событие и строка истории, поэтому решаем заранее.
  let nextStage: PipelineStage | null = null;
  if (patch.stage_id && patch.stage_id !== deal.stage_id) {
    const resolved = await resolveTargetStage(
      ctx,
      patch.pipeline_id ?? deal.pipeline_id,
      patch.stage_id,
    );
    nextStage = resolved.stage;
  }

  await transaction(async (tx) => {
    const closedAt = nextStage
      ? isClosedKind(nextStage.kind)
        ? (deal.closed_at ?? new Date().toISOString())
        : null
      : deal.closed_at;

    await tx
      .prepare(
        `UPDATE core.deals SET
            pipeline_id = ?, stage_id = ?, title = ?, amount = ?, client_id = ?, assignee_id = ?,
            contact_name = ?, contact_phone = ?, contact_email = ?, contact_telegram = ?,
            source_id = ?, utm_source = ?, utm_medium = ?, utm_campaign = ?, utm_term = ?,
            utm_content = ?, referrer = ?, landing_page = ?, lost_reason_id = ?, closed_at = ?
          WHERE id = ?`,
      )
      .run(
        nextStage ? nextStage.pipeline_id : deal.pipeline_id,
        nextStage ? nextStage.id : deal.stage_id,
        patch.title !== undefined ? patch.title.trim() : deal.title,
        patch.amount !== undefined ? patch.amount : deal.amount,
        patch.client_id !== undefined ? patch.client_id : deal.client_id,
        patch.assignee_id !== undefined ? patch.assignee_id : deal.assignee_id,
        patch.contact_name !== undefined ? patch.contact_name : deal.contact_name,
        patch.contact_phone !== undefined ? patch.contact_phone : deal.contact_phone,
        patch.contact_email !== undefined ? patch.contact_email : deal.contact_email,
        patch.contact_telegram !== undefined ? patch.contact_telegram : deal.contact_telegram,
        patch.source_id !== undefined ? patch.source_id : deal.source_id,
        patch.utm_source !== undefined ? patch.utm_source : deal.utm_source,
        patch.utm_medium !== undefined ? patch.utm_medium : deal.utm_medium,
        patch.utm_campaign !== undefined ? patch.utm_campaign : deal.utm_campaign,
        patch.utm_term !== undefined ? patch.utm_term : deal.utm_term,
        patch.utm_content !== undefined ? patch.utm_content : deal.utm_content,
        patch.referrer !== undefined ? patch.referrer : deal.referrer,
        patch.landing_page !== undefined ? patch.landing_page : deal.landing_page,
        patch.lost_reason_id !== undefined ? patch.lost_reason_id : deal.lost_reason_id,
        closedAt,
        dealId,
      );

    if (nextStage) {
      await tx
        .prepare(
          `INSERT INTO core.deal_stage_history (org_id, deal_id, stage_id, actor_id)
           VALUES (?, ?, ?, ?)`,
        )
        .run(ctx.orgId, dealId, nextStage.id, ctx.user.id);
      await emitEvent(tx, {
        orgId: ctx.orgId,
        actorId: ctx.user.id,
        entityType: "deal",
        entityId: dealId,
        // Отдельные глаголы у выигрыша и проигрыша: по ним подписываются
        // вебхуки, и «сделка обновлена» на выигрыш читалось бы как шум.
        verb:
          nextStage.kind === "won"
            ? "deal.won"
            : nextStage.kind === "lost"
              ? "deal.lost"
              : "deal.stage_changed",
        payload: { title: deal.title, stage_id: nextStage.id, stage_name: nextStage.name },
      });
    } else {
      await emitEvent(tx, {
        orgId: ctx.orgId,
        actorId: ctx.user.id,
        entityType: "deal",
        entityId: dealId,
        verb: "deal.updated",
        payload: { title: deal.title, fields: Object.keys(patch) },
      });
    }
  });

  return getDeal(ctx, dealId);
}

export async function deleteDeal(ctx: AuthContext, dealId: string): Promise<void> {
  assertOrg(ctx, "crm.manage");
  const deal = await getDeal(ctx, dealId);
  await transaction(async (tx: TxContext) => {
    await tx.prepare(`DELETE FROM core.deals WHERE id = ?`).run(dealId);
    await emitEvent(tx, {
      orgId: ctx.orgId,
      actorId: ctx.user.id,
      entityType: "deal",
      entityId: dealId,
      verb: "deal.deleted",
      payload: { title: deal.title },
    });
  });
}

// --- Аналитика -----------------------------------------------------------------------

/**
 * Сколько сделок входило в каждый этап за период. Именно ВХОДИЛО, а не «лежит
 * сейчас»: сделка, проехавшая этап за час, в снимке доски не видна вовсе, а в
 * конверсии обязана быть. Одна сделка на этап считается один раз, даже если
 * возвращалась туда дважды.
 */
export async function stageEntries(
  ctx: AuthContext,
  opts: { pipelineId: string; days?: number | null },
): Promise<Map<string, number>> {
  assertOrg(ctx, "crm.view");
  // Границу периода считает Postgres, а не процесс приложения: в контейнере
  // часовой пояс — UTC, и посчитанное в JS «за 30 дней» разъехалось бы с тем,
  // что видит читатель отчёта. Заодно это снимает вопрос к чистоте рендера:
  // серверному компоненту не нужно звать часы.
  const rows = await prepare<{ stage_id: string; deals: number }>(
    `SELECT h.stage_id, count(DISTINCT h.deal_id)::int AS deals
       FROM core.deal_stage_history h
       JOIN core.pipeline_stages s ON s.id = h.stage_id
      WHERE h.org_id = ? AND s.pipeline_id = ?
        AND (?::int IS NULL OR h.entered_at >= now() - make_interval(days => ?::int))
      GROUP BY h.stage_id`,
  ).all(ctx.orgId, opts.pipelineId, opts.days ?? null, opts.days ?? null);
  return new Map(rows.map((r) => [r.stage_id, r.deals]));
}
