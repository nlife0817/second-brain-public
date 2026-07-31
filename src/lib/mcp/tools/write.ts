// Инструменты правки задач: создание, изменение, комментарии, связи, удаление.
//
// Ни одной проверки прав здесь нет намеренно: их делает доменный слой, который
// зовут эти же функции из интерфейса. Задача файла — только перевести аргументы
// модели в термины сервисов.

import { z } from "zod";
import { addTaskComment, deleteComment } from "@/lib/core/comments";
import { setTaskFieldValue } from "@/lib/core/fields";
import { DomainError } from "@/lib/core/http";
import { listStatuses } from "@/lib/core/orgmeta";
import { createRelation, deleteRelation } from "@/lib/core/relations";
import {
  createTask,
  deleteTask,
  getTaskDetail,
  setFollowing,
  setTaskPlacements,
  updateTask,
} from "@/lib/core/tasks";
import { listFields } from "@/lib/core/fields";
import { loadDictionaries, shapeTaskDetail } from "../shape";
import { reply, tool, uuid } from "../types";

const priority = z.enum(["urgent", "high", "medium", "low", "none"]);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Дата в формате YYYY-MM-DD");
const time = z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/, "Время в формате HH:MM");

/**
 * Описание принимается только HTML — тем же документом, каким его хранит
 * редактор. Markdown в обе стороны схлопывал бы колонки, подписи к картинкам и
 * якоря обсуждений; читать документ модель при этом продолжает Markdown'ом.
 */
const descriptionHtml = z
  .string()
  .describe(
    "HTML описания (как у Tiptap: <p>, <h2>, <ul>/<li>, <strong>, <a>, <table>). " +
      "Перезаписывает описание целиком, поэтому сначала возьми исходник через get_task с include_html.",
  );

/** Карточка после правки — чтобы модель видела результат, а не отправляла второй запрос. */
async function taskReply(ctx: Parameters<typeof getTaskDetail>[0], taskId: string) {
  const [detail, dict, fields] = await Promise.all([
    getTaskDetail(ctx, taskId),
    loadDictionaries(ctx),
    listFields(ctx),
  ]);
  return reply({ task: shapeTaskDetail(detail, dict, fields) });
}

export const writeTools = [
  tool({
    name: "create_task",
    title: "Создать задачу",
    description:
      "Новая задача. Без проектов она попадает в личный инбокс; без исполнителей им становится владелец токена — " +
      "это правило самого трекера, а не инструмента.",
    write: true,
    input: z.object({
      title: z.string().min(1).max(500),
      description_html: descriptionHtml.optional(),
      project_ids: z.array(uuid).optional().describe("Проекты, в которых появится задача"),
      status_id: uuid.optional().describe("По умолчанию — статус организации по умолчанию"),
      priority: priority.optional(),
      assignee_ids: z.array(uuid).optional(),
      tag_ids: z.array(uuid).optional(),
      start_date: date.nullish(),
      start_time: time.nullish(),
      due_date: date.nullish(),
      due_time: time.nullish(),
      estimated_minutes: z.number().int().min(0).nullish(),
      parent_task_id: uuid.optional().describe("Сделать задачу подзадачей указанной"),
    }),
    handler: async (ctx, args) => {
      const task = await createTask(ctx, {
        title: args.title,
        description: args.description_html,
        status_id: args.status_id,
        priority: args.priority,
        start_date: args.start_date,
        start_time: args.start_time,
        due_date: args.due_date,
        due_time: args.due_time,
        estimated_minutes: args.estimated_minutes,
        parent_task_id: args.parent_task_id,
        placements: args.project_ids?.map((project_id) => ({ project_id })),
        assignee_ids: args.assignee_ids,
        tag_ids: args.tag_ids,
        // Откуда приехала задача. Колонка у задач своя и означает канал
        // появления — рядом с `source` события, но это разные вещи.
        source: "claude",
      });
      return taskReply(ctx, task.id);
    },
  }),

  tool({
    name: "update_task",
    title: "Изменить задачу",
    description:
      "Правка полей задачи. Передавай только то, что меняешь: отсутствующее поле остаётся как было, " +
      "а null означает «очистить». Списки исполнителей, меток и проектов задаются целиком.",
    write: true,
    input: z.object({
      task_id: uuid,
      title: z.string().min(1).max(500).optional(),
      description_html: descriptionHtml.optional(),
      status_id: uuid.nullish().describe("null — вернуть статус организации по умолчанию"),
      priority: priority.optional(),
      assignee_ids: z.array(uuid).optional().describe("Полный список исполнителей; [] — снять всех"),
      tag_ids: z.array(uuid).optional(),
      project_ids: z.array(uuid).optional().describe("Полный список проектов задачи"),
      start_date: date.nullish(),
      start_time: time.nullish(),
      due_date: date.nullish(),
      due_time: time.nullish(),
      estimated_minutes: z.number().int().min(0).nullish(),
      parent_task_id: uuid.nullish().describe("null — отвязать от родителя"),
      field_values: z
        .array(z.object({ field_id: uuid, value: z.unknown() }))
        .optional()
        .describe("Значения кастомных полей; value = null очищает поле"),
      archive: z
        .boolean()
        .optional()
        .describe("true — отправить в архив (первый статус категории archived), false — вернуть в работу"),
    }),
    handler: async (ctx, args) => {
      const { task_id: taskId, project_ids, field_values, archive, description_html, ...patch } = args;

      // Архив — действие, а не «ещё один статус»: в ряду статусов карточки его
      // нет, и модель не должна угадывать id архивного статуса.
      let statusId = patch.status_id;
      if (archive !== undefined) {
        const statuses = await listStatuses(ctx);
        const target = archive
          ? statuses.find((s) => s.category === "archived")
          : statuses.find((s) => s.is_default) ?? statuses.find((s) => s.category === "backlog");
        if (!target) {
          throw new DomainError(422, archive ? "В организации нет архивных статусов" : "В организации нет статусов");
        }
        statusId = target.id;
      }

      const hasPatch =
        Object.keys(patch).length > 0 || statusId !== undefined || description_html !== undefined;
      if (hasPatch) {
        await updateTask(ctx, taskId, {
          ...patch,
          status_id: statusId,
          description: description_html,
        });
      }
      if (project_ids) {
        await setTaskPlacements(ctx, taskId, project_ids.map((project_id) => ({ project_id })));
      }
      for (const fv of field_values ?? []) {
        await setTaskFieldValue(ctx, taskId, fv.field_id, fv.value ?? null);
      }
      return taskReply(ctx, taskId);
    },
  }),

  tool({
    name: "add_comment",
    title: "Комментарий",
    description:
      "Комментарий к задаче. Тело — HTML (<p>…</p>). Комментарий будет помечен как оставленный через Claude " +
      "и подпишет владельца токена на задачу — как и в интерфейсе.",
    write: true,
    input: z.object({
      task_id: uuid,
      body_html: z.string().min(1).describe("HTML комментария, например <p>Готово</p>"),
      reply_to_comment_id: uuid.optional().describe("Ответ в существующем обсуждении"),
    }),
    handler: async (ctx, args) => {
      const comment = await addTaskComment(ctx, args.task_id, args.body_html, args.reply_to_comment_id ?? null);
      return reply({ comment_id: comment.id, created_at: comment.created_at });
    },
  }),

  tool({
    name: "delete_comment",
    title: "Удалить комментарий",
    description: "Удаление комментария. Свой удаляет автор, чужой — администратор организации. Ответы уходят вместе с корнем.",
    write: true,
    input: z.object({ comment_id: uuid }),
    handler: async (ctx, args) => {
      await deleteComment(ctx, args.comment_id);
      return reply({ ok: true });
    },
  }),

  tool({
    name: "follow_task",
    title: "Подписка на задачу",
    description: "Подписать владельца токена на обновления задачи или отписать его.",
    write: true,
    input: z.object({ task_id: uuid, follow: z.boolean().default(true) }),
    handler: async (ctx, args) => {
      await setFollowing(ctx, args.task_id, args.follow);
      return reply({ ok: true, following: args.follow });
    },
  }),

  tool({
    name: "link_task",
    title: "Связь между объектами",
    description:
      "Связать задачу с задачей, проектом или клиентом — либо удалить связь по её id. " +
      "Тип связи берётся из get_org_settings; без него связь остаётся без ярлыка.",
    write: true,
    input: z.object({
      action: z.enum(["create", "delete"]),
      source_task_id: uuid.optional().describe("Задача-источник (для create)"),
      target_type: z.enum(["task", "project", "client"]).optional(),
      target_id: uuid.optional(),
      relation_type_id: uuid.nullish(),
      relation_id: uuid.optional().describe("Для delete"),
    }),
    handler: async (ctx, args) => {
      if (args.action === "delete") {
        if (!args.relation_id) throw new DomainError(422, "delete требует relation_id");
        await deleteRelation(ctx, args.relation_id);
        return reply({ ok: true });
      }
      if (!args.source_task_id || !args.target_type || !args.target_id) {
        throw new DomainError(422, "create требует source_task_id, target_type и target_id");
      }
      const relations = await createRelation(ctx, {
        source_type: "task",
        source_id: args.source_task_id,
        target_type: args.target_type,
        target_id: args.target_id,
        relation_type_id: args.relation_type_id,
      });
      return reply({ relations });
    },
  }),

  tool({
    name: "delete_task",
    title: "Удалить задачу",
    description:
      "Безвозвратное удаление задачи вместе с подзадачами и комментариями. " +
      "Если задачу нужно просто убрать из работы — вернее update_task с archive: true.",
    write: true,
    input: z.object({ task_id: uuid }),
    handler: async (ctx, args) => {
      await deleteTask(ctx, args.task_id);
      return reply({ ok: true });
    },
  }),
];
