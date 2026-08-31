// База знаний: дерево документов, правка с историей версий, корзина, доступ и
// связи с задачами.
//
// Правила доступа — в policy.ts, их загрузка — в kb-access.ts, чистые функции
// дерева и склейки версий — в kb-model.ts. Здесь только работа с данными.
//
// Ключевое, что задаёт форму всему файлу: доступ и привязка к проектам живут
// ТОЛЬКО у корня ветки (`parent_id IS NULL`), вложенные наследуют. Поэтому почти
// каждая операция сначала смотрит, корень перед ней или нет.

import { prepare, transaction, type TxContext } from "@/lib/sql";
import { sanitizeRichText } from "@/lib/sanitize";
import { listOwnerAttachments } from "./attachments";
import { listDocComments } from "./doc-comments";
import { emitEvent, notifyUsers } from "./events";
import { DomainError } from "./http";
import {
  KB_MAX_DEPTH,
  kbAudience,
  loadKbAccess,
  requireKbAccess,
  type KbAccess,
} from "./kb-access";
import {
  buildKbTree,
  isDisposableDocument,
  isMeaningfulRevision,
  kindRank,
  normalizeOrder,
  shouldSquashVersion,
  UNTITLED,
  type KbNodeRow,
} from "./kb-model";
import { notifyMentions } from "./mentions";
import { normalizeWorkbook, serializeWorkbook, SHEET_LIMITS } from "./sheet/model";
import { assertOrg, canProject, effectiveKbRole, effectiveProjectRole } from "./policy";
import { requireProject } from "./projects";
import { filterVisibleTaskIds, requireTaskAccess, updateTask } from "./tasks";
import type {
  AuthContext,
  KbDocument,
  KbDocumentDetail,
  KbDocumentMemberWithUser,
  KbDocumentVersion,
  KbFolderChild,
  KbNodeKind,
  KbLinkedDocument,
  KbLinkedTask,
  KbTreeGroup,
  KbTreeNode,
  PolicyProject,
  ProjectDefaultRole,
  ProjectRole,
} from "./types";

/** Длиннее в дереве всё равно не читается, а в базе занимает место зря. */
const TITLE_MAX = 200;

function cleanTitle(raw: string | null | undefined): string {
  return (raw ?? "").replace(/\s+/g, " ").trim().slice(0, TITLE_MAX);
}

/**
 * Тело узла в том виде, в каком оно ложится в базу.
 *
 * Развилка ровно одна и она здесь: у документа тело — HTML и проходит
 * санитайзер, у таблицы — JSON книги и проходит `normalizeWorkbook` (он же
 * держит пределы по листам и ячейкам), у папки тела нет вовсе. Размазать эту
 * развилку по вызывающим значит однажды записать книгу через санитайзер и
 * потерять её целиком.
 */
function cleanBody(kind: KbNodeKind, raw: string | null | undefined): string {
  if (kind === "folder") return "";
  if (kind !== "sheet") return sanitizeRichText(raw ?? "");
  const source = (raw ?? "").trim();
  if (!source) return serializeWorkbook(normalizeWorkbook(null));
  if (source.length > SHEET_LIMITS.bytes) {
    throw new DomainError(422, "Таблица слишком велика");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    throw new DomainError(422, "Не удалось разобрать таблицу");
  }
  return serializeWorkbook(normalizeWorkbook(parsed));
}

/** Класть внутрь можно только в папку — второго способа вложения нет. */
function assertFolder(access: KbAccess): void {
  if (access.document.kind !== "folder") {
    throw new DomainError(422, "Вкладывать можно только в папку");
  }
}

// --- Дерево ---------------------------------------------------------------------

interface TreeSource {
  rows: Array<KbNodeRow & { default_role: ProjectDefaultRole | null; created_by: string | null }>;
  /** Привязки корней к проектам, с позицией в дереве каждого проекта. */
  links: Array<{ document_id: string; project_id: string; position: number }>;
  memberRoles: Map<string, ProjectRole>;
  projects: Array<PolicyProject & { position: number }>;
}

async function loadTreeSource(ctx: AuthContext): Promise<TreeSource> {
  const [rows, links, members, projects] = await Promise.all([
    prepare<TreeSource["rows"][number]>(
      `SELECT id, kind, parent_id, title, position, created_at,
              default_role::text AS default_role, created_by
       FROM core.kb_documents
       WHERE org_id = ? AND deleted_at IS NULL`,
    ).all(ctx.orgId),
    prepare<TreeSource["links"][number]>(
      `SELECT dp.document_id, dp.project_id, dp.position
       FROM core.kb_document_projects dp
       JOIN core.kb_documents d ON d.id = dp.document_id
       WHERE d.org_id = ? AND d.deleted_at IS NULL`,
    ).all(ctx.orgId),
    prepare<{ document_id: string; role: ProjectRole }>(
      `SELECT dm.document_id, dm.role::text AS role
       FROM core.kb_document_members dm
       JOIN core.kb_documents d ON d.id = dm.document_id
       WHERE d.org_id = ? AND dm.user_id = ?`,
    ).all(ctx.orgId, ctx.user.id),
    prepare<PolicyProject & { position: number }>(
      `SELECT id, org_id, default_role::text AS default_role, position
       FROM core.projects
       WHERE org_id = ? AND archived_at IS NULL
       ORDER BY position, created_at`,
    ).all(ctx.orgId),
  ]);
  return {
    rows,
    links,
    memberRoles: new Map(members.map((m) => [m.document_id, m.role])),
    projects,
  };
}

/**
 * Дерево базы знаний целиком: разделы по проектам плюс «Общие».
 *
 * Считается в памяти, а не выборкой на каждый узел: документов в организации
 * сотни, а видимость корня зависит сразу от нескольких проектов — SQL, который
 * повторил бы `effectiveKbRole`, разошёлся бы с ним на первой же правке правил.
 *
 * Порядок разделов — порядок проектов в панели (`core.projects.position`): он
 * один на организацию, и второй порядок тех же проектов читался бы как ошибка.
 *
 * Пустые разделы остаются в выдаче: раздел — это ещё и место, где заводят
 * первый документ проекта. Отдавать только непустые значило бы, что в новом
 * проекте базу знаний нечем начать.
 */
export async function listKbTree(ctx: AuthContext): Promise<KbTreeGroup[]> {
  const src = await loadTreeSource(ctx);

  const projectById = new Map(src.projects.map((p) => [p.id, p]));
  const linksByDocument = new Map<string, Array<{ project_id: string; position: number }>>();
  for (const link of src.links) {
    const list = linksByDocument.get(link.document_id);
    if (list) list.push(link);
    else linksByDocument.set(link.document_id, [link]);
  }

  // Видимость решается на корне; потомки её наследуют.
  const visibleRoots = new Set<string>();
  for (const row of src.rows) {
    if (row.parent_id) continue;
    const linked = (linksByDocument.get(row.id) ?? [])
      .map((l) => projectById.get(l.project_id))
      .filter((p): p is PolicyProject & { position: number } => !!p);
    const role = effectiveKbRole(ctx, {
      id: row.id,
      org_id: ctx.orgId,
      created_by: row.created_by,
      default_role: row.default_role,
      projects: linked,
      member_role: src.memberRoles.get(row.id) ?? null,
    });
    if (role) visibleRoots.add(row.id);
  }

  // Потомки видимого корня видимы; ветка невидимого корня не показывается вовсе.
  const childrenOf = new Map<string, TreeSource["rows"]>();
  for (const row of src.rows) {
    if (!row.parent_id) continue;
    const list = childrenOf.get(row.parent_id);
    if (list) list.push(row);
    else childrenOf.set(row.parent_id, [row]);
  }
  const visibleRows: TreeSource["rows"] = [];
  const stack = src.rows.filter((r) => !r.parent_id && visibleRoots.has(r.id));
  const seen = new Set<string>();
  while (stack.length) {
    const row = stack.pop()!;
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    visibleRows.push(row);
    for (const child of childrenOf.get(row.id) ?? []) stack.push(child);
  }

  const nodesByRoot = new Map(buildKbTree(visibleRows).map((n) => [n.id, n]));

  const groups: KbTreeGroup[] = [];
  for (const project of src.projects) {
    if (!effectiveProjectRole(ctx, project)) continue;
    const nodes: KbTreeNode[] = [];
    for (const link of src.links) {
      if (link.project_id !== project.id) continue;
      const node = nodesByRoot.get(link.document_id);
      // Позиция у корня своя в каждом проекте — подменяем её копией узла, а не
      // правкой на месте: тот же документ стоит и в других разделах.
      if (node) nodes.push({ ...node, position: link.position });
    }
    nodes.sort(
      (a, b) =>
        kindRank(a.kind) - kindRank(b.kind) ||
        a.position - b.position ||
        a.title.localeCompare(b.title),
    );
    groups.push({ project_id: project.id, nodes });
  }

  // «Общие» всегда первыми: это не проект, и в порядке проектов ему места нет.
  const common = [...nodesByRoot.values()].filter((n) => !linksByDocument.has(n.id));
  groups.unshift({ project_id: null, nodes: common });
  return groups;
}

// --- Документ --------------------------------------------------------------------

function mapDocument(row: KbAccess["document"]): KbDocument {
  return {
    id: row.id,
    org_id: row.org_id,
    kind: row.kind,
    parent_id: row.parent_id,
    title: row.title,
    body: row.body,
    position: row.position,
    default_role: row.default_role as ProjectDefaultRole | null,
    created_by: row.created_by,
    updated_by: row.updated_by,
    created_at: row.created_at,
    updated_at: row.updated_at,
    deleted_at: row.deleted_at,
    deleted_by: row.deleted_by,
  };
}

/**
 * Содержимое папки. Доступ у детей общий с ней — он живёт на корне ветки,
 * поэтому поштучно его проверять не нужно.
 */
async function folderChildren(folderId: string): Promise<KbFolderChild[]> {
  const rows = await prepare<{
    id: string;
    kind: KbNodeKind;
    title: string;
    position: number;
    updated_at: string;
    u_id: string | null;
    u_email: string | null;
    u_name: string | null;
    u_avatar: string | null;
  }>(
    `SELECT d.id, d.kind, d.title, d.position, d.updated_at,
            u.id AS u_id, u.email AS u_email, u.name AS u_name, u.avatar_url AS u_avatar
     FROM core.kb_documents d
     LEFT JOIN core.users u ON u.id = d.updated_by
     WHERE d.parent_id = ? AND d.deleted_at IS NULL
     ORDER BY d.kind DESC, d.position, d.created_at`,
  ).all(folderId);
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    title: r.title,
    position: r.position,
    updated_at: r.updated_at,
    updated_by: r.u_id
      ? { id: r.u_id, email: r.u_email ?? "", name: r.u_name ?? "", avatar_url: r.u_avatar }
      : null,
  }));
}

async function documentDetail(ctx: AuthContext, access: KbAccess): Promise<KbDocumentDetail> {
  const kind = access.document.kind;
  const folder = kind === "folder";
  const owner = { kind: "document" as const, documentId: access.document.id };
  // У папки нет ни текста, ни вложений, ни обсуждений — и запросов за ними тоже.
  // У таблицы нет обсуждений к фрагментам: якорь комментария живёт в разметке,
  // а ячейка — не разметка. Вложения у неё есть: там лежит исходный файл.
  const [tasks, attachments, threads, children] = await Promise.all([
    folder ? Promise.resolve([]) : listDocumentTasks(ctx, access.document.id),
    folder ? Promise.resolve([]) : listOwnerAttachments(ctx, owner),
    kind === "document" ? listDocComments(ctx, owner) : Promise.resolve([]),
    folder ? folderChildren(access.document.id) : Promise.resolve([]),
  ]);
  return {
    ...mapDocument(access.document),
    root_id: access.root.id,
    root_title: access.root.title,
    my_role: access.role,
    project_ids: access.projectIds,
    path: access.path,
    tasks,
    attachments,
    threads,
    children,
  };
}

export async function getKbDocument(ctx: AuthContext, documentId: string): Promise<KbDocumentDetail> {
  const access = await requireKbAccess(ctx, documentId, "doc.view");
  return documentDetail(ctx, access);
}

export interface KbCreateInput {
  title?: string;
  body?: string;
  /** Папка или документ. По умолчанию документ. */
  kind?: KbNodeKind;
  /** Родитель в дереве — только папка. Есть — доступ наследуется от корня. */
  parentId?: string | null;
  /** Проекты корня. Пусто и без родителя — «общий» узел. */
  projectIds?: string[];
}

/**
 * Новый документ. Три случая и три разных права:
 *  - вложенный — правка родителя (`doc.edit`);
 *  - корень в проектах — `doc.create` в каждом из них;
 *  - общий — `kb.create.common` (сотрудник, но не гость).
 */
export async function createKbDocument(
  ctx: AuthContext,
  input: KbCreateInput,
): Promise<KbDocumentDetail> {
  const parentId = input.parentId ?? null;
  const kind: KbNodeKind = input.kind ?? "document";
  const projectIds = [...new Set(input.projectIds ?? [])];
  const title = cleanTitle(input.title) || UNTITLED;
  const body = cleanBody(kind, input.body);

  let parent: KbAccess | null = null;
  if (parentId) {
    if (projectIds.length > 0) {
      throw new DomainError(422, "Вложенный узел наследует доступ от корня ветки");
    }
    parent = await requireKbAccess(ctx, parentId, "doc.edit");
    assertFolder(parent);
    if (parent.path.length >= KB_MAX_DEPTH) {
      throw new DomainError(422, `Глубже ${KB_MAX_DEPTH} уровней вложенности не поддерживается`);
    }
  } else if (projectIds.length > 0) {
    for (const projectId of projectIds) await requireProject(ctx, projectId, "doc.create");
  } else {
    assertOrg(ctx, "kb.create.common");
  }

  const id = crypto.randomUUID();
  await transaction(async (tx) => {
    const position = await nextPosition(tx, ctx.orgId, parentId, projectIds[0] ?? null);
    await tx
      .prepare(
        `INSERT INTO core.kb_documents (id, org_id, kind, parent_id, title, body, position, created_by, updated_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, ctx.orgId, kind, parentId, title, body, position, ctx.user.id, ctx.user.id);

    for (const projectId of projectIds) {
      await tx
        .prepare(
          `INSERT INTO core.kb_document_projects (document_id, project_id, position) VALUES (?, ?, ?)`,
        )
        .run(id, projectId, await nextPosition(tx, ctx.orgId, null, projectId));
    }

    await emitEvent(tx, {
      orgId: ctx.orgId,
      actorId: ctx.user.id,
      entityType: "kb_document",
      entityId: id,
      verb: "kb_document.created",
      payload: { title, kind, parent_id: parentId, project_ids: projectIds },
    });
  });

  return getKbDocument(ctx, id);
}

/** Место в конце списка соседей. Позиции нормализуются перестановкой, здесь просто хвост. */
async function nextPosition(
  tx: TxContext,
  orgId: string,
  parentId: string | null,
  projectId: string | null,
): Promise<number> {
  if (parentId) {
    const row = await tx
      .prepare<{ next: number }>(
        `SELECT COALESCE(max(position), 0) + 1 AS next FROM core.kb_documents WHERE parent_id = ?`,
      )
      .get(parentId);
    return row?.next ?? 1;
  }
  if (projectId) {
    const row = await tx
      .prepare<{ next: number }>(
        `SELECT COALESCE(max(position), 0) + 1 AS next FROM core.kb_document_projects WHERE project_id = ?`,
      )
      .get(projectId);
    return row?.next ?? 1;
  }
  const row = await tx
    .prepare<{ next: number }>(
      `SELECT COALESCE(max(d.position), 0) + 1 AS next
       FROM core.kb_documents d
       WHERE d.org_id = ? AND d.parent_id IS NULL AND d.deleted_at IS NULL
         AND NOT EXISTS (SELECT 1 FROM core.kb_document_projects dp WHERE dp.document_id = d.id)`,
    )
    .get(orgId);
  return row?.next ?? 1;
}

/**
 * Правка текста и заголовка.
 *
 * Событие пишем на каждую содержательную правку (правило 7), а вот уведомления
 * шлём только упомянутым: документ автосохраняется раз в полторы секунды, и
 * строка в инбоксе на каждое сохранение превратила бы правку регламента в
 * рассылку на всю команду. Пустое сохранение (текст не изменился) не пишет
 * ни события, ни версии.
 */
export async function updateKbDocument(
  ctx: AuthContext,
  documentId: string,
  patch: { title?: string; body?: string },
): Promise<KbDocumentDetail> {
  const access = await requireKbAccess(ctx, documentId, "doc.edit");
  const kind = access.document.kind;
  const folder = kind === "folder";
  if (folder && patch.body !== undefined) throw new DomainError(422, "У папки нет текста");
  const previous = { title: access.document.title, body: access.document.body };
  const next = {
    title: patch.title === undefined ? previous.title : cleanTitle(patch.title) || UNTITLED,
    body: patch.body === undefined ? previous.body : cleanBody(kind, patch.body),
  };
  if (!isMeaningfulRevision(previous, next)) return documentDetail(ctx, access);

  await transaction(async (tx) => {
    await tx
      .prepare(
        `UPDATE core.kb_documents SET title = ?, body = ?, updated_by = ? WHERE id = ? AND org_id = ?`,
      )
      .run(next.title, next.body, ctx.user.id, documentId, ctx.orgId);

    // Историю ведёт только документ: у папки нечего восстанавливать.
    if (!folder) await writeVersion(tx, ctx, documentId, next);

    const eventId = await emitEvent(tx, {
      orgId: ctx.orgId,
      actorId: ctx.user.id,
      entityType: "kb_document",
      entityId: documentId,
      verb: "kb_document.updated",
      payload: { title: next.title },
    });
    // Упоминания живут в разметке описания; в JSON книги их нет и искать
    // их там нечего.
    if (kind === "document") {
      await notifyMentions(tx, {
        orgId: ctx.orgId,
        eventId,
        owner: { kind: "document", documentId },
        actorId: ctx.user.id,
        html: next.body,
        prevHtml: previous.body,
      });
    }
  });

  return getKbDocument(ctx, documentId);
}

/**
 * Точка возврата. Правки одного автора подряд склеиваются в одну версию —
 * иначе автосохранение оставляло бы по строке каждые несколько секунд
 * (`shouldSquashVersion`).
 */
async function writeVersion(
  tx: TxContext,
  ctx: AuthContext,
  documentId: string,
  next: { title: string; body: string },
): Promise<void> {
  const last = await tx
    .prepare<{ id: string; author_id: string | null; updated_at: string }>(
      `SELECT id, author_id, updated_at FROM core.kb_document_versions
       WHERE document_id = ? ORDER BY created_at DESC LIMIT 1`,
    )
    .get(documentId);

  if (shouldSquashVersion(last ?? null, ctx.user.id, new Date())) {
    await tx
      .prepare(
        `UPDATE core.kb_document_versions SET title = ?, body = ?, updated_at = now() WHERE id = ?`,
      )
      .run(next.title, next.body, last!.id);
    return;
  }
  await tx
    .prepare(
      `INSERT INTO core.kb_document_versions (org_id, document_id, title, body, author_id)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(ctx.orgId, documentId, next.title, next.body, ctx.user.id);
}

// --- Перемещение и порядок --------------------------------------------------------

export interface KbMoveInput {
  /** Новый родитель. `null` — документ становится корнем. */
  parentId: string | null;
  /**
   * Раздел, в который встаёт корень: проект или «Общие» (`null`). Учитывается
   * только при `parentId === null`.
   */
  projectId?: string | null;
  /**
   * Раздел, из которого документ утащили. Нужен, потому что корень стоит сразу
   * в нескольких проектах: перенос из «Сторонних проектов» в «Заметки» обязан
   * снять привязку к первому и не тронуть остальные. `null` — тащили из «Общих».
   */
  fromProjectId?: string | null;
  /** Порядок соседей после переноса — целиком, как у статусов и проектов. */
  order?: string[];
}

/**
 * Перенос документа по дереву — тем же жестом, что и перестановка соседей.
 *
 * Право зависит от того, меняется ли источник доступа. Перенос внутри своей
 * ветки — обычная правка (`doc.edit`). Перенос в другую ветку или из проекта в
 * проект меняет то, кто видит документ, поэтому требует `doc.manage` на самом
 * документе: иначе редактор одного проекта открывал бы чужой закрытый регламент
 * всей своей команде.
 */
export async function moveKbDocument(
  ctx: AuthContext,
  documentId: string,
  input: KbMoveInput,
): Promise<KbTreeGroup[]> {
  const access = await requireKbAccess(ctx, documentId, "doc.edit");
  const parentId = input.parentId ?? null;
  if (parentId === documentId) throw new DomainError(422, "Документ нельзя вложить в себя");

  const subtree = await loadSubtreeIds(documentId);
  if (parentId && subtree.includes(parentId)) {
    throw new DomainError(422, "Документ нельзя вложить в собственную ветку");
  }

  let parent: KbAccess | null = null;
  if (parentId) {
    parent = await requireKbAccess(ctx, parentId, "doc.edit");
    assertFolder(parent);
    const depth = await subtreeDepth(documentId);
    if (parent.path.length + depth > KB_MAX_DEPTH) {
      throw new DomainError(422, `Глубже ${KB_MAX_DEPTH} уровней вложенности не поддерживается`);
    }
  }

  const nextProjectId = parentId ? null : (input.projectId ?? null);
  const wasRoot = !access.document.parent_id;
  const nextRootId = parent ? parent.root.id : documentId;

  // Каким станет набор проектов корня. Уронили в «Общие» — привязок не остаётся
  // вовсе (в этом и смысл раздела); уронили в проект — меняется только та
  // привязка, из которой тащили.
  const currentProjects = wasRoot ? access.projectIds : [];
  let nextProjects: string[] = [];
  if (!parentId) {
    if (nextProjectId) {
      nextProjects = currentProjects.filter((id) => id !== (input.fromProjectId ?? null));
      if (!nextProjects.includes(nextProjectId)) nextProjects.push(nextProjectId);
    }
  }
  const projectsChanged = !parentId && !sameProjects(currentProjects, nextProjects);

  if (access.root.id !== nextRootId || projectsChanged) {
    // Источник доступа меняется — это уже не перестановка, а передача документа.
    await requireKbAccess(ctx, documentId, "doc.manage");
  }
  for (const projectId of nextProjects) {
    if (!currentProjects.includes(projectId)) await requireProject(ctx, projectId, "doc.create");
  }

  await transaction(async (tx) => {
    // Родитель и базовая роль меняются ОДНИМ стейтментом: у вложенного узла
    // базовой роли быть не может (kb_documents_role_root_ck), и порознь
    // констрейнт ловит промежуточное состояние — «уже вложен, но роль ещё
    // своя». Ровно на этом падал перенос корня с открытым доступом.
    await tx
      .prepare(
        `UPDATE core.kb_documents
         SET parent_id = ?,
             default_role = CASE WHEN ?::uuid IS NULL THEN default_role ELSE NULL END
         WHERE id = ? AND org_id = ?`,
      )
      .run(parentId, parentId, documentId, ctx.orgId);

    if (parentId) {
      // Вложенный узел не имеет ни собственных проектов, ни списка доступа:
      // и то и другое живёт на корне ветки.
      await tx.prepare(`DELETE FROM core.kb_document_projects WHERE document_id = ?`).run(documentId);
      await tx.prepare(`DELETE FROM core.kb_document_members WHERE document_id = ?`).run(documentId);
    } else if (projectsChanged) {
      await tx.prepare(`DELETE FROM core.kb_document_projects WHERE document_id = ?`).run(documentId);
      for (const projectId of nextProjects) {
        await tx
          .prepare(
            `INSERT INTO core.kb_document_projects (document_id, project_id, position) VALUES (?, ?, ?)`,
          )
          .run(documentId, projectId, await nextPosition(tx, ctx.orgId, null, projectId));
      }
      if (nextProjects.length === 0) {
        // Документ стал общим — доступ теперь по списку. Переносящего добавляем
        // явно: иначе он в тот же миг теряет документ из виду, если он не автор.
        await tx
          .prepare(
            `INSERT INTO core.kb_document_members (document_id, user_id, role) VALUES (?, ?, 'admin')
             ON CONFLICT (document_id, user_id) DO UPDATE SET role = 'admin'`,
          )
          .run(documentId, ctx.user.id);
      }
    }

    if (input.order?.length) {
      await writeOrder(tx, ctx, { parentId, projectId: nextProjectId, order: input.order });
    } else if (!parentId) {
      await tx
        .prepare(`UPDATE core.kb_documents SET position = ? WHERE id = ?`)
        .run(await nextPosition(tx, ctx.orgId, null, nextProjectId), documentId);
    } else {
      await tx
        .prepare(`UPDATE core.kb_documents SET position = ? WHERE id = ?`)
        .run(await nextPosition(tx, ctx.orgId, parentId, null), documentId);
    }

    await emitEvent(tx, {
      orgId: ctx.orgId,
      actorId: ctx.user.id,
      entityType: "kb_document",
      entityId: documentId,
      verb: "kb_document.moved",
      payload: { parent_id: parentId, project_id: nextProjectId },
    });
  });

  return listKbTree(ctx);
}

function sameProjects(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((id) => set.has(id));
}

export interface KbReorderInput {
  /** Ветка, внутри которой меняется порядок. */
  parentId: string | null;
  /** Раздел корней: проект или «Общие». Учитывается при `parentId === null`. */
  projectId?: string | null;
  order: string[];
}

/**
 * Порядок соседей приходит целиком — как справочник статусов и порядок проектов:
 * перетаскивание сдвигает соседей, и патч одной позиции оставил бы список в
 * промежуточном состоянии между запросами.
 *
 * Событий не пишем — сознательное исключение из правила 7, то же, что у порядка
 * проектов: место строки в дереве не меняет ни одного документа по существу.
 */
export async function reorderKbDocuments(
  ctx: AuthContext,
  input: KbReorderInput,
): Promise<KbTreeGroup[]> {
  const order = [...new Set(input.order)];
  if (order.length !== input.order.length) throw new DomainError(422, "Документ повторяется в порядке");
  // Право проверяем на каждом переставляемом документе: у корней «Общих» доступ
  // персональный, и одной проверки на список не хватит.
  for (const id of order) await requireKbAccess(ctx, id, "doc.edit");

  await transaction(async (tx) => {
    await writeOrder(tx, ctx, {
      parentId: input.parentId ?? null,
      projectId: input.projectId ?? null,
      order,
    });
  });
  return listKbTree(ctx);
}

async function writeOrder(
  tx: TxContext,
  ctx: AuthContext,
  input: { parentId: string | null; projectId: string | null; order: string[] },
): Promise<void> {
  for (const { id, position } of normalizeOrder(input.order)) {
    if (!input.parentId && input.projectId) {
      // Позиция корня своя в каждом проекте — она лежит в строке привязки.
      await tx
        .prepare(
          `UPDATE core.kb_document_projects SET position = ? WHERE document_id = ? AND project_id = ?`,
        )
        .run(position, id, input.projectId);
      continue;
    }
    await tx
      .prepare(`UPDATE core.kb_documents SET position = ? WHERE id = ? AND org_id = ?`)
      .run(position, id, ctx.orgId);
  }
}

/** id ветки целиком, включая корень. Нужен переносу, удалению и восстановлению. */
async function loadSubtreeIds(documentId: string): Promise<string[]> {
  const rows = await prepare<{ id: string }>(
    `WITH RECURSIVE sub AS (
       SELECT id, 0 AS depth FROM core.kb_documents WHERE id = ?
       UNION ALL
       SELECT c.id, s.depth + 1 FROM core.kb_documents c JOIN sub s ON c.parent_id = s.id
       WHERE s.depth < 32
     )
     SELECT id FROM sub`,
  ).all(documentId);
  return rows.map((r) => r.id);
}

/** Высота ветки в уровнях (сам документ — 1). */
async function subtreeDepth(documentId: string): Promise<number> {
  const row = await prepare<{ depth: number }>(
    `WITH RECURSIVE sub AS (
       SELECT id, 1 AS depth FROM core.kb_documents WHERE id = ?
       UNION ALL
       SELECT c.id, s.depth + 1 FROM core.kb_documents c JOIN sub s ON c.parent_id = s.id
       WHERE s.depth < 32
     )
     SELECT max(depth)::int AS depth FROM sub`,
  ).get(documentId);
  return row?.depth ?? 1;
}

// --- Корзина ----------------------------------------------------------------------

/** Удаление мягкое и уносит ветку целиком: документ без раздела читается как пропажа. */
export async function deleteKbDocument(ctx: AuthContext, documentId: string): Promise<void> {
  await requireKbAccess(ctx, documentId, "doc.delete");
  const ids = await loadSubtreeIds(documentId);
  await transaction(async (tx) => {
    await tx
      .prepare(
        `UPDATE core.kb_documents SET deleted_at = now(), deleted_by = ?
         WHERE id IN (${ids.map(() => "?").join(",")}) AND deleted_at IS NULL`,
      )
      .run(ctx.user.id, ids);
    await emitEvent(tx, {
      orgId: ctx.orgId,
      actorId: ctx.user.id,
      entityType: "kb_document",
      entityId: documentId,
      verb: "kb_document.trashed",
      payload: { count: ids.length },
    });
  });
}

/**
 * Возврат из корзины. Поднимаем не только ветку, но и удалённых предков:
 * иначе документ вернулся бы в раздел, которого больше нет, и пропал бы из
 * дерева во второй раз.
 */
export async function restoreKbDocument(ctx: AuthContext, documentId: string): Promise<void> {
  const access = await requireKbAccess(ctx, documentId, "doc.delete", { includeDeleted: true });
  const ids = [...new Set([...access.path.map((p) => p.id), ...(await loadSubtreeIds(documentId))])];
  await transaction(async (tx) => {
    await tx
      .prepare(
        `UPDATE core.kb_documents SET deleted_at = NULL, deleted_by = NULL
         WHERE id IN (${ids.map(() => "?").join(",")}) AND org_id = ?`,
      )
      .run(ids, ctx.orgId);
    await emitEvent(tx, {
      orgId: ctx.orgId,
      actorId: ctx.user.id,
      entityType: "kb_document",
      entityId: documentId,
      verb: "kb_document.restored",
      payload: { count: ids.length },
    });
  });
}

export interface KbTrashItem {
  id: string;
  kind: KbNodeKind;
  title: string;
  deleted_at: string;
  deleted_by: string | null;
  /** Сколько узлов вернётся вместе с этим — ветка целиком, а не только дети. */
  descendants: number;
}

/**
 * Корзина показывает верхние документы удалённых веток, а не каждый узел:
 * снесли раздел с десятком страниц — в списке одна строка, и вернётся она целиком.
 */
export async function listKbTrash(ctx: AuthContext): Promise<KbTrashItem[]> {
  const rows = await prepare<KbTrashItem>(
    // Считаем ветку целиком, а не прямых детей: восстановление вернёт именно
    // её, и «и 6 вложенных» у папки с внуками было бы неправдой.
    `SELECT d.id, d.kind, d.title, d.deleted_at, d.deleted_by, sub.n AS descendants
     FROM core.kb_documents d
     LEFT JOIN core.kb_documents p ON p.id = d.parent_id
     CROSS JOIN LATERAL (
       WITH RECURSIVE branch AS (
         SELECT c.id FROM core.kb_documents c
         WHERE c.parent_id = d.id AND c.deleted_at IS NOT NULL
         UNION ALL
         SELECT c.id FROM core.kb_documents c
         JOIN branch b ON c.parent_id = b.id
         WHERE c.deleted_at IS NOT NULL
       )
       SELECT count(*)::int AS n FROM branch
     ) sub
     WHERE d.org_id = ? AND d.deleted_at IS NOT NULL
       AND (d.parent_id IS NULL OR p.deleted_at IS NULL)
     ORDER BY d.deleted_at DESC`,
  ).all(ctx.orgId);

  const out: KbTrashItem[] = [];
  for (const row of rows) {
    // Видимость проверяем поштучно: у корней «Общих» она персональная, а
    // корзина — такая же выдача наружу, как поиск (правило 8).
    const access = await loadKbAccess(ctx, row.id, { includeDeleted: true });
    if (access) out.push(row);
  }
  return out;
}

/** Окончательное удаление: байты вложений и история версий уходят каскадом. */
export async function purgeKbDocument(ctx: AuthContext, documentId: string): Promise<void> {
  const access = await requireKbAccess(ctx, documentId, "doc.manage", { includeDeleted: true });
  if (!access.document.deleted_at) throw new DomainError(422, "Документ не в корзине");
  await transaction(async (tx) => {
    await tx.prepare(`DELETE FROM core.kb_documents WHERE id = ? AND org_id = ?`).run(documentId, ctx.orgId);
    await emitEvent(tx, {
      orgId: ctx.orgId,
      actorId: ctx.user.id,
      entityType: "kb_document",
      entityId: documentId,
      verb: "kb_document.purged",
      payload: { title: access.document.title },
    });
  });
}

// --- Доступ ------------------------------------------------------------------------

function assertRoot(access: KbAccess): void {
  if (access.document.parent_id) {
    throw new DomainError(422, "Доступ настраивается на верхнем документе ветки");
  }
}

/** Привязка корня к проектам. Пустой список превращает документ в «общий». */
export async function setKbProjects(
  ctx: AuthContext,
  documentId: string,
  projectIds: string[],
): Promise<KbDocumentDetail> {
  const access = await requireKbAccess(ctx, documentId, "doc.manage");
  assertRoot(access);
  const next = [...new Set(projectIds)];
  for (const projectId of next) await requireProject(ctx, projectId, "doc.create");

  await transaction(async (tx) => {
    await tx.prepare(`DELETE FROM core.kb_document_projects WHERE document_id = ?`).run(documentId);
    for (const projectId of next) {
      await tx
        .prepare(
          `INSERT INTO core.kb_document_projects (document_id, project_id, position) VALUES (?, ?, ?)`,
        )
        .run(documentId, projectId, await nextPosition(tx, ctx.orgId, null, projectId));
    }
    if (next.length === 0) {
      // Документ стал общим: без этой строки настроивший его человек тут же
      // теряет доступ, если он не автор и не владелец организации.
      await tx
        .prepare(
          `INSERT INTO core.kb_document_members (document_id, user_id, role) VALUES (?, ?, 'admin')
           ON CONFLICT (document_id, user_id) DO UPDATE SET role = 'admin'`,
        )
        .run(documentId, ctx.user.id);
    }
    await emitEvent(tx, {
      orgId: ctx.orgId,
      actorId: ctx.user.id,
      entityType: "kb_document",
      entityId: documentId,
      verb: "kb_document.projects_changed",
      payload: { project_ids: next },
    });
  });

  return getKbDocument(ctx, documentId);
}

/** Базовая роль общего документа. `null` — закрытый, только по списку. */
export async function setKbDefaultRole(
  ctx: AuthContext,
  documentId: string,
  role: ProjectDefaultRole | null,
): Promise<KbDocumentDetail> {
  const access = await requireKbAccess(ctx, documentId, "doc.manage");
  assertRoot(access);
  if (access.projectIds.length > 0) {
    throw new DomainError(422, "У документа в проектах доступ берётся из них");
  }
  await transaction(async (tx) => {
    await tx
      .prepare(`UPDATE core.kb_documents SET default_role = ?::core.project_role WHERE id = ? AND org_id = ?`)
      .run(role, documentId, ctx.orgId);
    await emitEvent(tx, {
      orgId: ctx.orgId,
      actorId: ctx.user.id,
      entityType: "kb_document",
      entityId: documentId,
      verb: "kb_document.access_changed",
      payload: { default_role: role },
    });
  });
  return getKbDocument(ctx, documentId);
}

export async function listKbMembers(
  ctx: AuthContext,
  documentId: string,
): Promise<KbDocumentMemberWithUser[]> {
  const access = await requireKbAccess(ctx, documentId, "doc.view");
  return prepare<KbDocumentMemberWithUser>(
    `SELECT dm.document_id, dm.user_id, dm.role::text AS role, u.email, u.name, u.avatar_url
     FROM core.kb_document_members dm
     JOIN core.users u ON u.id = dm.user_id
     WHERE dm.document_id = ?
     ORDER BY u.name`,
  ).all(access.root.id);
}

/** Добавить, изменить или (при `role === null`) убрать участника общего документа. */
export async function setKbMember(
  ctx: AuthContext,
  documentId: string,
  userId: string,
  role: ProjectRole | null,
): Promise<KbDocumentMemberWithUser[]> {
  const access = await requireKbAccess(ctx, documentId, "doc.manage");
  assertRoot(access);
  if (access.projectIds.length > 0) {
    throw new DomainError(422, "У документа в проектах состав задают проекты");
  }
  const member = await prepare<{ user_id: string }>(
    `SELECT user_id FROM core.org_members WHERE org_id = ? AND user_id = ?`,
  ).get(ctx.orgId, userId);
  if (!member) throw new DomainError(404, "Участник не найден");

  await transaction(async (tx) => {
    if (role) {
      await tx
        .prepare(
          `INSERT INTO core.kb_document_members (document_id, user_id, role) VALUES (?, ?, ?::core.project_role)
           ON CONFLICT (document_id, user_id) DO UPDATE SET role = excluded.role`,
        )
        .run(documentId, userId, role);
    } else {
      await tx
        .prepare(`DELETE FROM core.kb_document_members WHERE document_id = ? AND user_id = ?`)
        .run(documentId, userId);
    }
    const eventId = await emitEvent(tx, {
      orgId: ctx.orgId,
      actorId: ctx.user.id,
      entityType: "kb_document",
      entityId: documentId,
      verb: role ? "kb_document.member_added" : "kb_document.member_removed",
      payload: { user_id: userId, role },
    });
    if (role) {
      await notifyUsers(tx, {
        orgId: ctx.orgId,
        eventId,
        kind: "kb_document_shared",
        userIds: [userId],
        excludeUserId: ctx.user.id,
      });
    }
  });

  return listKbMembers(ctx, documentId);
}

// --- Версии --------------------------------------------------------------------------

export async function listKbVersions(
  ctx: AuthContext,
  documentId: string,
): Promise<KbDocumentVersion[]> {
  await requireKbAccess(ctx, documentId, "doc.view");
  const rows = await prepare<{
    id: string;
    document_id: string;
    title: string;
    author_id: string | null;
    created_at: string;
    updated_at: string;
    u_id: string | null;
    u_email: string | null;
    u_name: string | null;
    u_avatar: string | null;
  }>(
    // Тело в список не берём: история на сотню правок весила бы мегабайты.
    `SELECT v.id, v.document_id, v.title, v.author_id, v.created_at, v.updated_at,
            u.id AS u_id, u.email AS u_email, u.name AS u_name, u.avatar_url AS u_avatar
     FROM core.kb_document_versions v
     LEFT JOIN core.users u ON u.id = v.author_id
     WHERE v.document_id = ?
     ORDER BY v.created_at DESC`,
  ).all(documentId);
  return rows.map((r) => ({
    id: r.id,
    document_id: r.document_id,
    title: r.title,
    author_id: r.author_id,
    created_at: r.created_at,
    updated_at: r.updated_at,
    author: r.u_id
      ? { id: r.u_id, email: r.u_email ?? "", name: r.u_name ?? "", avatar_url: r.u_avatar }
      : null,
  }));
}

export async function getKbVersion(
  ctx: AuthContext,
  documentId: string,
  versionId: string,
): Promise<KbDocumentVersion> {
  await requireKbAccess(ctx, documentId, "doc.view");
  const row = await prepare<KbDocumentVersion>(
    `SELECT id, document_id, title, body, author_id, created_at, updated_at
     FROM core.kb_document_versions WHERE id = ? AND document_id = ?`,
  ).get(versionId, documentId);
  if (!row) throw new DomainError(404, "Версия не найдена");
  return { ...row, author: null };
}

/**
 * Возврат к версии — обычная правка поверх текущей, а не откат истории: то, что
 * было, остаётся в истории отдельной точкой, иначе «восстановил не то» стало бы
 * необратимым.
 */
export async function restoreKbVersion(
  ctx: AuthContext,
  documentId: string,
  versionId: string,
): Promise<KbDocumentDetail> {
  await requireKbAccess(ctx, documentId, "doc.edit");
  const version = await prepare<{ title: string; body: string }>(
    `SELECT title, body FROM core.kb_document_versions WHERE id = ? AND document_id = ?`,
  ).get(versionId, documentId);
  if (!version) throw new DomainError(404, "Версия не найдена");

  await transaction(async (tx) => {
    await tx
      .prepare(
        `UPDATE core.kb_documents SET title = ?, body = ?, updated_by = ? WHERE id = ? AND org_id = ?`,
      )
      .run(version.title, version.body, ctx.user.id, documentId, ctx.orgId);
    // Новая точка, а не склейка с последней: восстановление — отдельное событие
    // в истории, даже если предыдущую правку делал тот же человек минуту назад.
    await tx
      .prepare(
        `INSERT INTO core.kb_document_versions (org_id, document_id, title, body, author_id)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(ctx.orgId, documentId, version.title, version.body, ctx.user.id);
    await emitEvent(tx, {
      orgId: ctx.orgId,
      actorId: ctx.user.id,
      entityType: "kb_document",
      entityId: documentId,
      verb: "kb_document.version_restored",
      payload: { version_id: versionId },
    });
  });

  return getKbDocument(ctx, documentId);
}

// --- Связь с задачами ----------------------------------------------------------------

/** Задачи документа. Фильтруются видимостью задач: связь ничего не открывает. */
export async function listDocumentTasks(
  ctx: AuthContext,
  documentId: string,
): Promise<KbLinkedTask[]> {
  const rows = await prepare<KbLinkedTask>(
    `SELECT t.id, t.title, t.status_id, t.completed_at
     FROM core.kb_document_tasks dt
     JOIN core.tasks t ON t.id = dt.task_id
     WHERE dt.document_id = ? AND t.org_id = ?
     ORDER BY dt.created_at`,
  ).all(documentId, ctx.orgId);
  if (rows.length === 0) return [];
  const visible = await filterVisibleTaskIds(ctx, rows.map((r) => r.id));
  return rows.filter((r) => visible.has(r.id));
}

/** Документы задачи — блок «Документы» в карточке. Фильтруются видимостью документов. */
export async function listTaskDocuments(
  ctx: AuthContext,
  taskId: string,
): Promise<KbLinkedDocument[]> {
  const rows = await prepare<KbLinkedDocument>(
    `SELECT d.id, d.title
     FROM core.kb_document_tasks dt
     JOIN core.kb_documents d ON d.id = dt.document_id
     WHERE dt.task_id = ? AND d.org_id = ? AND d.deleted_at IS NULL
     ORDER BY dt.created_at`,
  ).all(taskId, ctx.orgId);
  const out: KbLinkedDocument[] = [];
  for (const row of rows) {
    if (await loadKbAccess(ctx, row.id)) out.push(row);
  }
  return out;
}

/**
 * Связать документ с задачей. Право — правка документа плюс доступ к задаче:
 * связь появляется в документе, поэтому решает он, а видеть задачу всё равно
 * нужно — иначе привязка становится способом проверить её существование по id.
 */
export async function linkKbTask(
  ctx: AuthContext,
  documentId: string,
  taskId: string,
): Promise<KbLinkedTask[]> {
  await requireKbAccess(ctx, documentId, "doc.edit");
  const visible = await filterVisibleTaskIds(ctx, [taskId]);
  if (!visible.has(taskId)) throw new DomainError(404, "Задача не найдена");

  await transaction(async (tx) => {
    await tx
      .prepare(
        `INSERT INTO core.kb_document_tasks (document_id, task_id, created_by) VALUES (?, ?, ?)
         ON CONFLICT DO NOTHING`,
      )
      .run(documentId, taskId, ctx.user.id);
    await emitEvent(tx, {
      orgId: ctx.orgId,
      actorId: ctx.user.id,
      entityType: "kb_document",
      entityId: documentId,
      verb: "kb_document.task_linked",
      payload: { task_id: taskId },
    });
  });
  return listDocumentTasks(ctx, documentId);
}

export async function unlinkKbTask(
  ctx: AuthContext,
  documentId: string,
  taskId: string,
): Promise<KbLinkedTask[]> {
  await requireKbAccess(ctx, documentId, "doc.edit");
  await transaction(async (tx) => {
    await tx
      .prepare(`DELETE FROM core.kb_document_tasks WHERE document_id = ? AND task_id = ?`)
      .run(documentId, taskId);
    await emitEvent(tx, {
      orgId: ctx.orgId,
      actorId: ctx.user.id,
      entityType: "kb_document",
      entityId: documentId,
      verb: "kb_document.task_unlinked",
      payload: { task_id: taskId },
    });
  });
  return listDocumentTasks(ctx, documentId);
}

/** Кого оповещать о документе — реэкспорт для рассылок вне этого модуля. */
export { kbAudience };

// --- Описание задачи → документ --------------------------------------------------

export interface KbFromTaskInput {
  title?: string;
  parentId?: string | null;
  /** Куда положить корень. По умолчанию — проекты самой задачи. */
  projectIds?: string[];
  /**
   * Заменить описание задачи ссылкой на документ. Иначе описание остаётся, а
   * документ становится его копией — дальше они живут независимо.
   */
  replaceDescription?: boolean;
}

/**
 * Перенести описание задачи в базу знаний.
 *
 * Вложения именно **копируются**, а не перепривязываются: у документа и задачи
 * доступ разный, и картинка, оставшаяся за задачей, не открылась бы у того, кто
 * видит только документ. Обратная сторона — исходное вложение остаётся за
 * задачей; если описание заменили ссылкой, ссылок на него не остаётся, и через
 * сутки его уберёт `purgeOrphanAttachments`.
 *
 * Ход действия собран из обычных операций (создание, правка, связь), а не из
 * своего SQL: иначе правила доступа и события пришлось бы повторять здесь.
 */
export async function createKbDocumentFromTask(
  ctx: AuthContext,
  taskId: string,
  input: KbFromTaskInput = {},
): Promise<KbDocumentDetail> {
  const replace = input.replaceDescription ?? false;
  const access = await requireTaskAccess(ctx, taskId, replace ? "edit" : "view");
  const task = access.task;

  // По умолчанию документ живёт там же, где задача, — но только в тех её
  // проектах, где человек вправе заводить документы.
  const projectIds =
    input.projectIds ??
    access.placements
      .filter((p) => canProject(ctx, "doc.create", p.project))
      .map((p) => p.project_id);

  const created = await createKbDocument(ctx, {
    title: input.title ?? task.title,
    parentId: input.parentId ?? null,
    projectIds: input.parentId ? undefined : projectIds,
  });

  const body = await copyAttachmentsToDocument(ctx, taskId, created.id, task.description ?? "");
  const document = body
    ? await updateKbDocument(ctx, created.id, { body })
    : await getKbDocument(ctx, created.id);

  await linkKbTask(ctx, created.id, taskId);

  if (replace) {
    // Ссылка, а не пустое описание: иначе из задачи не видно, куда уехал текст.
    // Экранировать нечего — подставляется только uuid и уже очищенный заголовок.
    const title = escapeHtml(document.title || "Документ");
    await updateTask(ctx, taskId, {
      description: `<p><a href="/v2/kb/${document.id}">${title}</a></p>`,
    });
  }

  return getKbDocument(ctx, created.id);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Копии вложений описания под новым владельцем и переписанные на них ссылки.
 * Копируем только то, на что описание действительно ссылается: загруженное и
 * тут же удалённое из текста тащить в документ незачем.
 */
async function copyAttachmentsToDocument(
  ctx: AuthContext,
  taskId: string,
  documentId: string,
  html: string,
): Promise<string> {
  if (!html.trim()) return "";
  const rows = await prepare<{ id: string }>(
    `SELECT id FROM core.attachments WHERE task_id = ? AND org_id = ?`,
  ).all(taskId, ctx.orgId);

  let body = html;
  for (const row of rows) {
    if (!body.includes(row.id)) continue;
    const copy = await prepare<{ id: string }>(
      `INSERT INTO core.attachments
         (org_id, document_id, uploaded_by, filename, mime_type, byte_size, width, height, data)
       SELECT org_id, ?, uploaded_by, filename, mime_type, byte_size, width, height, data
       FROM core.attachments WHERE id = ?
       RETURNING id`,
    ).get(documentId, row.id);
    if (copy) body = body.split(row.id).join(copy.id);
  }
  return body;
}

// --- Уборка пустых документов ------------------------------------------------------

/**
 * Есть ли у документа хоть что-нибудь, кроме заголовка и текста: вложения,
 * обсуждения, привязанные задачи, история правок или вложенные узлы. Любого
 * из этого достаточно, чтобы документ не считался брошенным.
 */
async function hasAnyContent(documentId: string): Promise<boolean> {
  const row = await prepare<{ any_content: boolean }>(
    `SELECT (
       EXISTS (SELECT 1 FROM core.attachments WHERE document_id = ?)
       OR EXISTS (SELECT 1 FROM core.doc_comments WHERE document_id = ? AND deleted_at IS NULL)
       OR EXISTS (SELECT 1 FROM core.kb_document_tasks WHERE document_id = ?)
       OR EXISTS (SELECT 1 FROM core.kb_document_versions WHERE document_id = ?)
       OR EXISTS (SELECT 1 FROM core.kb_documents WHERE parent_id = ?)
     ) AS any_content`,
  ).get(documentId, documentId, documentId, documentId, documentId);
  return !!row?.any_content;
}

/**
 * Убрать документ, если в него так ничего и не добавили.
 *
 * Зовётся, когда человек уходит со страницы документа. Документ заводится одним
 * нажатием «плюса», и передумать — обычное дело; такие пустышки копятся в
 * дереве и мешают находить настоящее.
 *
 * Удаление здесь **жёсткое, мимо корзины**: в корзине пустышке делать нечего,
 * восстанавливать в ней нечего. Решает сервер, а не браузер, — иначе правило
 * «что считать пустым» разошлось бы между вкладкой и уборкой в cron.
 */
export async function discardEmptyKbDocument(
  ctx: AuthContext,
  documentId: string,
): Promise<{ removed: boolean }> {
  const access = await requireKbAccess(ctx, documentId, "doc.delete");
  const disposable = isDisposableDocument({
    kind: access.document.kind,
    title: access.document.title,
    body: access.document.body,
    hasContent: await hasAnyContent(documentId),
  });
  if (!disposable) return { removed: false };

  await transaction(async (tx) => {
    await tx
      .prepare(`DELETE FROM core.kb_documents WHERE id = ? AND org_id = ?`)
      .run(documentId, ctx.orgId);
    // Событие пишем: документ был создан событием, и лента не должна обрываться
    // на «создан» у того, чего уже нет.
    await emitEvent(tx, {
      orgId: ctx.orgId,
      actorId: ctx.user.id,
      entityType: "kb_document",
      entityId: documentId,
      verb: "kb_document.discarded",
      payload: {},
    });
  });
  return { removed: true };
}

/**
 * Та же уборка, но фоном: вкладку закрывают, не дождавшись запроса, и пустышка
 * остаётся в дереве навсегда. Сутки отсрочки — чтобы не унести документ,
 * открытый в соседней вкладке и ещё не заполненный.
 *
 * Зовётся из тика cron рядом с уборкой осиротевших вложений. Условие здесь
 * повторяет чистую `isDisposableDocument` — правя одно, правь второе (то же
 * требование, что у тихих часов и их SQL-зеркала).
 */
export async function purgeEmptyKbDocuments(): Promise<{ removed: number }> {
  const result = await prepare(
    `DELETE FROM core.kb_documents d
     WHERE d.kind IN ('document', 'sheet')
       AND d.deleted_at IS NULL
       AND d.created_at < now() - interval '1 day'
       AND btrim(coalesce(d.title, '')) IN ('', 'Без названия')
       AND (
         -- Документ: текста нет вовсе (пустой редактор отдаёт «<p></p>»).
         (d.kind = 'document'
          AND btrim(regexp_replace(coalesce(d.body, ''), '<[^>]*>|&nbsp;', '', 'g')) = '')
         -- Книга: ни одной заполненной ячейки. Пустые ячейки в JSON не попадают
         -- (см. setCell), поэтому отсутствие ключей в «cells» и есть пустота.
         OR (d.kind = 'sheet' AND coalesce(d.body, '') !~ '"cells":\s*\{\s*"')
       )
       AND NOT EXISTS (SELECT 1 FROM core.attachments a WHERE a.document_id = d.id)
       AND NOT EXISTS (SELECT 1 FROM core.doc_comments c WHERE c.document_id = d.id AND c.deleted_at IS NULL)
       AND NOT EXISTS (SELECT 1 FROM core.kb_document_tasks t WHERE t.document_id = d.id)
       AND NOT EXISTS (SELECT 1 FROM core.kb_document_versions v WHERE v.document_id = d.id)
       AND NOT EXISTS (SELECT 1 FROM core.kb_documents c WHERE c.parent_id = d.id)`,
  ).run();
  return { removed: result.changes };
}
