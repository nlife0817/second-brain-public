// Владелец вложения и обсуждения к тексту: задача либо документ базы знаний.
//
// Редактор описания и редактор документа — один и тот же код, поэтому и таблицы
// под ними одни (`core.attachments`, `core.doc_comments`, миграция 0055).
// Разница между владельцами сводится к четырём вещам: как проверяется доступ,
// какой сущностью помечается событие, кого оповещать и в какую колонку писать.
// Всё это собрано здесь, чтобы `attachments.ts` и `doc-comments.ts` не ветвились
// на каждом шаге.
//
// Тип `DocOwner` объявлен в `types.ts`, а не рядом: `mentions.ts` нужен только
// он, а импорт этого модуля замкнул бы `mentions` и `tasks` в кольцо.

import type { TxContext } from "@/lib/sql";
import { type EntityType, taskAudience } from "./events";
import { DomainError } from "./http";
import { kbAudience, requireKbAccess } from "./kb-access";
import { requireTaskAccess } from "./tasks";
import type { AuthContext, DocOwner } from "./types";

export type DocOwnerLevel = "view" | "comment" | "edit";

/** Владелец по строке таблицы: ровно одна из колонок заполнена (check в 0055). */
export function docOwnerOf(row: {
  task_id: string | null;
  document_id: string | null;
}): DocOwner {
  if (row.task_id) return { kind: "task", taskId: row.task_id };
  if (row.document_id) return { kind: "document", documentId: row.document_id };
  // Невозможно при живом check-констрейнте, но молчать об этом хуже, чем упасть.
  throw new DomainError(500, "У записи нет владельца");
}

/** Колонки владельца для INSERT: ровно одна заполнена. */
export function ownerColumns(owner: DocOwner): { taskId: string | null; documentId: string | null } {
  return owner.kind === "task"
    ? { taskId: owner.taskId, documentId: null }
    : { taskId: null, documentId: owner.documentId };
}

/** Сущность события. Лента задачи и история документа читают её по этой паре. */
export function ownerEntity(owner: DocOwner): { entityType: EntityType; entityId: string } {
  return owner.kind === "task"
    ? { entityType: "task", entityId: owner.taskId }
    : { entityType: "kb_document", entityId: owner.documentId };
}

/**
 * Проверка доступа к владельцу. Пороги одинаковые: смотреть — viewer,
 * комментировать — commenter, править — editor.
 */
export async function requireDocOwner(
  ctx: AuthContext,
  owner: DocOwner,
  level: DocOwnerLevel,
): Promise<void> {
  if (owner.kind === "task") {
    await requireTaskAccess(ctx, owner.taskId, level);
    return;
  }
  await requireKbAccess(
    ctx,
    owner.documentId,
    level === "edit" ? "doc.edit" : level === "comment" ? "doc.comment" : "doc.view",
  );
}

/** Кого оповестить об изменении: аудитория задачи либо аудитория документа. */
export async function docOwnerAudience(tx: TxContext, owner: DocOwner): Promise<string[]> {
  return owner.kind === "task"
    ? taskAudience(tx, owner.taskId)
    : kbAudience(tx, owner.documentId);
}
