// Доступ к документам базы знаний: загрузка эффективной роли и фильтр
// видимости для рассылок.
//
// Отдельно от kb.ts, потому что этим же доступом пользуются вложения и
// комментарии к тексту (`attachments.ts`, `doc-comments.ts`): импортируй они
// весь сервис — получилось бы кольцо, ведь kb.ts зовёт их сам.
//
// Правила решает policy.ts, здесь только выборки. Ровно три запроса на проверку
// (цепочка родителей, проекты корня, своя запись в корне) — см. правило про
// фиксированное число запросов в CLAUDE.md.

import { prepare, type TxContext } from "@/lib/sql";
import { DomainError } from "./http";
import { assertKbRole, effectiveKbRole, type KbAction } from "./policy";
import type { AuthContext, PolicyKbDocument, PolicyProject, ProjectRole } from "./types";

/**
 * Предел вложенности. Рекурсивный поиск корня обязан завершаться на битых
 * данных, а дерево глубже десятка уровней в узкой колонке всё равно нечитаемо;
 * запас нужен, чтобы уже сложившаяся ветка не перестала открываться.
 */
export const KB_MAX_DEPTH = 10;
const CHAIN_LIMIT = 32;

export interface KbDocumentRow {
  id: string;
  org_id: string;
  parent_id: string | null;
  title: string;
  body: string;
  position: number;
  default_role: ProjectRole | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  deleted_by: string | null;
}

export interface KbAccess {
  document: KbDocumentRow;
  /** Корень ветки: у него живут доступ и привязки. У самого корня — он сам. */
  root: KbDocumentRow;
  role: ProjectRole;
  /** Проекты корня. Пусто — документ «общий». */
  projectIds: string[];
  /** Путь от корня до документа включительно. */
  path: Array<{ id: string; title: string }>;
}

const DOCUMENT_COLUMNS = `id, org_id, parent_id, title, body, position, default_role::text AS default_role,
   created_by, updated_by, created_at, updated_at, deleted_at, deleted_by`;

/**
 * Цепочка от документа к корню. Первая строка — сам документ, последняя — корень.
 * Ограничение по глубине защищает от цикла в `parent_id`: данные битые, но
 * запрос обязан завершиться.
 */
async function loadChain(documentId: string): Promise<KbDocumentRow[]> {
  return prepare<KbDocumentRow & { depth: number }>(
    `WITH RECURSIVE chain AS (
       SELECT d.*, 0 AS depth FROM core.kb_documents d WHERE d.id = ?
       UNION ALL
       SELECT p.*, c.depth + 1 FROM core.kb_documents p
       JOIN chain c ON p.id = c.parent_id
       WHERE c.depth < ${CHAIN_LIMIT}
     )
     SELECT ${DOCUMENT_COLUMNS}, depth FROM chain ORDER BY depth`,
  ).all(documentId);
}

/** Проекты корня в виде, достаточном для policy. */
export async function loadRootProjects(rootId: string): Promise<PolicyProject[]> {
  return prepare<PolicyProject>(
    `SELECT p.id, p.org_id, p.default_role::text AS default_role
     FROM core.kb_document_projects dp
     JOIN core.projects p ON p.id = dp.project_id
     WHERE dp.document_id = ?
     ORDER BY dp.position, dp.created_at`,
  ).all(rootId);
}

/**
 * Эффективный доступ к документу. `null` — документа нет, он чужой, в корзине
 * или невидим: интерфейсу все четыре случая отдаются одинаково (404), иначе
 * перебором id можно узнать, что документ существует.
 */
export async function loadKbAccess(
  ctx: AuthContext,
  documentId: string,
  opts: { includeDeleted?: boolean } = {},
): Promise<KbAccess | null> {
  const chain = await loadChain(documentId);
  const document = chain[0];
  if (!document || document.org_id !== ctx.orgId) return null;
  if (!opts.includeDeleted && chain.some((row) => row.deleted_at)) return null;

  const root = chain[chain.length - 1];
  const projects = await loadRootProjects(root.id);
  // Список участников читаем только у общего документа: у документа в проектах
  // он в решении не участвует вовсе (см. effectiveKbRole).
  const member = projects.length
    ? null
    : await prepare<{ role: ProjectRole }>(
        `SELECT role::text AS role FROM core.kb_document_members WHERE document_id = ? AND user_id = ?`,
      ).get(root.id, ctx.user.id);

  const policyDoc: PolicyKbDocument = {
    id: root.id,
    org_id: root.org_id,
    created_by: root.created_by,
    default_role: root.default_role as PolicyKbDocument["default_role"],
    projects,
    member_role: member?.role ?? null,
  };
  const role = effectiveKbRole(ctx, policyDoc);
  if (!role) return null;

  return {
    document,
    root,
    role,
    projectIds: projects.map((p) => p.id),
    // Цепочка идёт от документа к корню — крошкам нужен обратный порядок.
    path: [...chain].reverse().map((row) => ({ id: row.id, title: row.title })),
  };
}

/** То же с проверкой права; 404 вместо 403, если документ не виден вовсе. */
export async function requireKbAccess(
  ctx: AuthContext,
  documentId: string,
  action: KbAction,
  opts: { includeDeleted?: boolean } = {},
): Promise<KbAccess> {
  const access = await loadKbAccess(ctx, documentId, opts);
  if (!access) throw new DomainError(404, "Документ не найден");
  // Роль уже посчитана загрузкой — выводить её второй раз из усечённого среза
  // документа нельзя: у автора с ролью viewer в проекте получился бы admin.
  assertKbRole(access.role, action);
  return access;
}

/**
 * Кто из перечисленных пользователей видит документ — SQL-зеркало
 * `effectiveKbRole` для рассылки упоминаний.
 *
 * Упомянуть можно любого участника организации, но уведомление несёт название
 * документа: без фильтра это дверь в закрытый проект (правило 8 в CLAUDE.md).
 * Правя `effectiveKbRole`, правь и это.
 */
export async function filterUsersWhoCanViewDocument(
  tx: TxContext,
  orgId: string,
  documentId: string,
  userIds: string[],
): Promise<string[]> {
  if (userIds.length === 0) return [];
  const ph = userIds.map(() => "?").join(",");
  const rows = await tx
    .prepare<{ user_id: string }>(
      `WITH RECURSIVE chain AS (
         SELECT d.id, d.parent_id, d.created_by, d.default_role, 0 AS depth
         FROM core.kb_documents d WHERE d.id = ? AND d.org_id = ?
         UNION ALL
         SELECT p.id, p.parent_id, p.created_by, p.default_role, c.depth + 1
         FROM core.kb_documents p JOIN chain c ON p.id = c.parent_id
         WHERE c.depth < ${CHAIN_LIMIT}
       ),
       root AS (SELECT * FROM chain ORDER BY depth DESC LIMIT 1),
       pl AS (
         SELECT pr.id AS project_id, pr.default_role
         FROM core.kb_document_projects dp
         JOIN core.projects pr ON pr.id = dp.project_id
         WHERE dp.document_id = (SELECT id FROM root)
       )
       SELECT m.user_id::text AS user_id
       FROM core.org_members m
       WHERE m.org_id = ? AND m.user_id IN (${ph}) AND (
             -- Документ в проектах: решают только проекты.
             (EXISTS (SELECT 1 FROM pl) AND (
                EXISTS (SELECT 1 FROM pl
                        JOIN core.project_members pm ON pm.project_id = pl.project_id
                        WHERE pm.user_id = m.user_id)
                OR EXISTS (SELECT 1 FROM pl WHERE pl.default_role IS NOT NULL
                           AND m.role IN ('owner', 'admin', 'member'))
             ))
          -- Общий документ: автор, владелец организации, явный участник,
          -- либо базовая роль — и только сотрудникам.
          OR (NOT EXISTS (SELECT 1 FROM pl) AND (
                EXISTS (SELECT 1 FROM root r WHERE r.created_by = m.user_id)
                OR m.role = 'owner'
                OR EXISTS (SELECT 1 FROM core.kb_document_members dm
                           WHERE dm.document_id = (SELECT id FROM root) AND dm.user_id = m.user_id)
                OR (EXISTS (SELECT 1 FROM root r WHERE r.default_role IS NOT NULL)
                    AND m.role IN ('owner', 'admin', 'member'))
             ))
       )`,
    )
    .all(documentId, orgId, orgId, userIds);
  return rows.map((r) => r.user_id);
}

/**
 * Кого оповестить об изменении документа: автор, все правившие его и явные
 * участники общего документа. Аудитория проектного документа — не «все, кто
 * его видит»: рассылать каждую правку регламента всей организации незачем.
 */
export async function kbAudience(tx: TxContext, documentId: string): Promise<string[]> {
  const rows = await tx
    .prepare<{ user_id: string }>(
      `SELECT created_by AS user_id FROM core.kb_documents WHERE id = ? AND created_by IS NOT NULL
       UNION
       SELECT author_id FROM core.kb_document_versions WHERE document_id = ? AND author_id IS NOT NULL
       UNION
       SELECT user_id FROM core.kb_document_members WHERE document_id = ?`,
    )
    .all(documentId, documentId, documentId);
  return rows.map((r) => r.user_id);
}
