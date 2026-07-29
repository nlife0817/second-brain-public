import { NextResponse } from "next/server";
import { listTaskComments } from "@/lib/core/comments";
import { withOrg } from "@/lib/core/context";
import { listDocComments } from "@/lib/core/doc-comments";
import { listEntityFeed } from "@/lib/core/events";
import { isUuid, jsonError } from "@/lib/core/http";
import { getTaskRule } from "@/lib/core/recurring";
import { listRelations, listRelationTypes } from "@/lib/core/relations";
import { getTaskDetail, listSubtasks, requireTaskAccess } from "@/lib/core/tasks";

/**
 * Всё содержимое карточки задачи за один запрос.
 *
 * Раньше открытие карточки стоило шести обращений к API (задача, комментарии,
 * лента, подзадачи и ещё два из блока связей). Каждое из них — отдельная
 * функция, которая заново разрешала пользователя, членство и роли проектов:
 * четыре запроса к базе до того, как дело дойдёт до самих данных. Здесь
 * авторизация считается один раз, а шесть выборок идут параллельно.
 *
 * Прежние точечные роуты оставлены: они используются после мутаций и внешними
 * потребителями.
 */
export const GET = withOrg(async (_request, { params, auth }) => {
  const { taskId } = await params;
  if (!isUuid(taskId)) return jsonError(404, "Task not found");
  // Один общий чек доступа — дальше выборки идут без повторной проверки прав.
  await requireTaskAccess(auth, taskId, "view");

  const [task, comments, feed, subtasks, relations, relation_types, recurrence, doc_comments] =
    await Promise.all([
      getTaskDetail(auth, taskId),
      listTaskComments(auth, taskId),
      listEntityFeed("task", taskId),
      listSubtasks(auth, taskId),
      listRelations(auth, "task", taskId),
      listRelationTypes(auth),
      // Повтор — свойство задачи и живёт в её карточке: отдельным запросом это
      // был бы седьмой поход туда же.
      getTaskRule(taskId, auth.orgId),
      // Комментарии к описанию едут вместе с карточкой: их количество рисуется
      // на кнопке «развернуть», то есть нужно ещё до открытия документа.
      listDocComments(auth, taskId),
    ]);

  return NextResponse.json({
    task,
    comments,
    feed,
    subtasks,
    relations,
    relation_types,
    recurrence,
    doc_comments,
  });
});
