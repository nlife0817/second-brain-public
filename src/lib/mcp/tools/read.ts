// Инструменты чтения: ориентация в организации, списки, карточка, вложения.

import { z } from "zod";
import { getAttachmentBytes, isInlineImage, listOwnerAttachments } from "@/lib/core/attachments";
import { listTaskComments } from "@/lib/core/comments";
import { listEntityFeed } from "@/lib/core/events";
import { listFields } from "@/lib/core/fields";
import { getOrganization, listOrgMembers } from "@/lib/core/identity";
import { listStatuses, listTags } from "@/lib/core/orgmeta";
import { listProjects, listProjectMembers, requireProject } from "@/lib/core/projects";
import { listRelations, listRelationTypes } from "@/lib/core/relations";
import { search } from "@/lib/core/search";
import {
  getTaskDetail,
  listAllTasks,
  listMyTasks,
  listProjectTasks,
  listSubtasks,
} from "@/lib/core/tasks";
import { DomainError } from "@/lib/core/http";
import { loadDictionaries, shapeComment, shapeEvent, shapeTaskDetail, shapeTaskListItem } from "../shape";
import { reply, tool, uuid, type ToolReply } from "../types";

/**
 * Потолок картинки, которую отдаём изображением. Больше — только метаданные:
 * мегабайты base64 в диалоге не помогают ни одной задаче, а контекст съедают
 * целиком. Файл при этом никуда не девается — он лежит в задаче.
 */
const IMAGE_INLINE_MAX_BYTES = 3 * 1024 * 1024;

export const readTools = [
  tool({
    name: "whoami",
    title: "Кто я и где",
    description:
      "Организация, от чьего имени идёт работа, роль этого человека и режим токена. " +
      "Стоит вызвать первым, если непонятно, в каком контексте выполняются остальные инструменты.",
    input: z.object({}),
    handler: async (ctx) => {
      const org = await getOrganization(ctx.orgId);
      return reply({
        user: { id: ctx.user.id, name: ctx.user.name, email: ctx.user.email },
        org: { id: ctx.orgId, name: org?.name ?? null },
        org_role: ctx.orgRole,
        explicit_project_roles: [...ctx.projectRoles].map(([project_id, role]) => ({ project_id, role })),
        note: "Действия выполняются правами этого пользователя и помечаются в истории как сделанные через Claude.",
      });
    },
  }),

  tool({
    name: "list_projects",
    title: "Проекты",
    description: "Проекты организации, доступные пользователю: id, название, доступ, число открытых задач.",
    input: z.object({
      include_archived: z.boolean().optional().describe("Показать и архивные проекты"),
    }),
    handler: async (ctx, args) => {
      const projects = await listProjects(ctx, { archived: args.include_archived });
      return reply({
        projects: projects.map((p) => ({
          id: p.id,
          name: p.name,
          description: p.description,
          access: p.default_role ? `открыт для сотрудников (${p.default_role})` : "закрытый",
          my_role: p.my_role,
          open_task_count: p.open_task_count,
          archived: !!p.archived_at,
        })),
      });
    },
  }),

  tool({
    name: "list_tasks",
    title: "Список задач",
    description:
      "Задачи: все доступные, задачи проекта, свои или подзадачи конкретной задачи. " +
      "Описание в список не входит — за ним идти в get_task.",
    input: z.object({
      scope: z
        .enum(["all", "project", "mine", "subtasks"])
        .default("all")
        .describe("Что перечисляем. project требует project_id, subtasks — parent_task_id"),
      project_id: uuid.optional(),
      parent_task_id: uuid.optional(),
      include_done: z.boolean().optional().describe("Показать и завершённые задачи"),
      query: z.string().optional().describe("Отбор по вхождению в название"),
      assignee_id: uuid.optional().describe("Только задачи этого исполнителя"),
      status_id: uuid.optional(),
      limit: z.number().int().min(1).max(200).default(50),
    }),
    handler: async (ctx, args) => {
      const dict = await loadDictionaries(ctx);
      let tasks;
      let truncated = false;
      switch (args.scope) {
        case "project": {
          if (!args.project_id) throw new DomainError(422, "scope=project требует project_id");
          tasks = await listProjectTasks(ctx, args.project_id, { includeDone: args.include_done });
          break;
        }
        case "subtasks": {
          if (!args.parent_task_id) throw new DomainError(422, "scope=subtasks требует parent_task_id");
          tasks = await listSubtasks(ctx, args.parent_task_id);
          break;
        }
        case "mine":
          tasks = await listMyTasks(ctx, { includeDone: args.include_done });
          break;
        default: {
          const all = await listAllTasks(ctx, { includeDone: args.include_done });
          tasks = all.tasks;
          truncated = all.truncated;
        }
      }

      // Отбор по названию, исполнителю и статусу идёт здесь, а не в SQL:
      // источников списка четыре, и свой WHERE у каждого означал бы четыре
      // копии одного правила. Списки и так ограничены сверху.
      const q = args.query?.trim().toLowerCase();
      const filtered = tasks.filter((t) => {
        if (q && !t.title.toLowerCase().includes(q)) return false;
        if (args.assignee_id && !t.assignees.some((a) => a.id === args.assignee_id)) return false;
        if (args.status_id && t.status_id !== args.status_id) return false;
        return true;
      });

      return reply({
        total_matched: filtered.length,
        truncated: truncated || filtered.length > args.limit,
        tasks: filtered.slice(0, args.limit).map((t) => shapeTaskListItem(t, dict)),
      });
    },
  }),

  tool({
    name: "get_task",
    title: "Карточка задачи",
    description:
      "Задача целиком: характеристики, описание в Markdown, комментарии, лента событий, подзадачи, " +
      "связи и список вложений. Картинки описания видны ссылками вида attachment:<id> — сам файл отдаёт get_attachment.",
    input: z.object({
      task_id: uuid,
      include_html: z.boolean().optional().describe("Добавить исходный HTML описания — нужен, чтобы его править"),
      include_feed: z.boolean().default(true).describe("Лента событий задачи"),
      feed_limit: z.number().int().min(1).max(200).default(30),
    }),
    handler: async (ctx, args) => {
      const [detail, dict, fields] = await Promise.all([
        getTaskDetail(ctx, args.task_id),
        loadDictionaries(ctx),
        listFields(ctx),
      ]);
      const [comments, subtasks, relations, attachments, feed] = await Promise.all([
        listTaskComments(ctx, args.task_id),
        listSubtasks(ctx, args.task_id),
        listRelations(ctx, "task", args.task_id),
        listOwnerAttachments(ctx, { kind: "task", taskId: args.task_id }),
        args.include_feed ? listEntityFeed("task", args.task_id, args.feed_limit) : Promise.resolve([]),
      ]);

      return reply({
        task: shapeTaskDetail(detail, dict, fields, { html: args.include_html }),
        comments: comments.map(shapeComment),
        subtasks: subtasks.map((t) => shapeTaskListItem(t, dict)),
        relations: relations.map((r) => ({
          id: r.id,
          direction: r.direction,
          entity_type: r.entity_type,
          entity_id: r.entity_id,
          title: r.title,
          relation_type_id: r.relation_type_id,
        })),
        attachments: attachments.map((a) => ({
          id: a.id,
          filename: a.filename,
          mime_type: a.mime_type,
          byte_size: a.byte_size,
          dimensions: a.width && a.height ? `${a.width}×${a.height}` : null,
        })),
        feed: feed.map(shapeEvent),
      });
    },
  }),

  tool({
    name: "get_attachment",
    title: "Файл задачи",
    description:
      "Содержимое вложения по id (в описании они выглядят как attachment:<id>). " +
      "Картинка приходит изображением, остальные форматы — метаданными; текстовые файлы можно получить текстом.",
    input: z.object({
      attachment_id: uuid,
      as_text: z.boolean().optional().describe("Отдать содержимое текстом — для .txt, .csv, .json и подобных"),
    }),
    handler: async (ctx, args): Promise<ToolReply> => {
      const file = await getAttachmentBytes(ctx, args.attachment_id);
      const meta = {
        filename: file.filename,
        mime_type: file.mimeType,
        byte_size: file.bytes.byteLength,
      };

      if (args.as_text) {
        // Двоичный файл, показанный «текстом», — это мусор в контексте и
        // сломанная кодировка; отказываем явно, а не отдаём кракозябры.
        const printable = /^(text\/|application\/(json|xml|x-yaml|yaml|csv))/i.test(file.mimeType);
        if (!printable) throw new DomainError(422, `${file.mimeType} — не текстовый формат`);
        return reply({ ...meta, text: file.bytes.toString("utf8").slice(0, 200_000) });
      }

      if (isInlineImage(file.mimeType)) {
        if (file.bytes.byteLength > IMAGE_INLINE_MAX_BYTES) {
          return reply({
            ...meta,
            note: "Картинка слишком большая, чтобы показывать её целиком. Открыть её можно в задаче.",
          });
        }
        return {
          content: [
            { type: "text", text: JSON.stringify(meta, null, 2) },
            { type: "image", data: file.bytes.toString("base64"), mimeType: file.mimeType },
          ],
          structuredContent: meta,
        };
      }

      return reply({
        ...meta,
        note: "Этот формат показывается только метаданными. Для текстовых файлов вызови инструмент с as_text.",
      });
    },
  }),

  tool({
    name: "search",
    title: "Поиск",
    description: "Сквозной поиск по задачам, проектам и клиентам. Отдаёт только доступное пользователю.",
    input: z.object({
      query: z.string().min(2),
      limit: z.number().int().min(1).max(50).default(20),
    }),
    handler: async (ctx, args) => {
      const hits = await search(ctx, args.query, args.limit);
      return reply({ hits });
    },
  }),

  tool({
    name: "get_org_settings",
    title: "Справочники организации",
    description:
      "Статусы задач, метки, кастомные поля, типы связей, участники организации и участники проекта. " +
      "Отсюда берутся id для create_task и update_task.",
    input: z.object({
      project_id: uuid.optional().describe("Добавить состав участников этого проекта"),
    }),
    handler: async (ctx, args) => {
      const [statuses, tags, fields, relationTypes, members] = await Promise.all([
        listStatuses(ctx),
        listTags(ctx),
        listFields(ctx),
        listRelationTypes(ctx),
        listOrgMembers(ctx.orgId),
      ]);
      // Состав проекта отдаётся только тому, кто вправе видеть сам проект:
      // listProjectMembers прав не проверяет — это делает вызывающий, как и в
      // роуте /projects/:id/members.
      let projectMembers = null;
      if (args.project_id) {
        await requireProject(ctx, args.project_id, "project.view");
        projectMembers = await listProjectMembers(args.project_id);
      }

      return reply({
        statuses: statuses.map((s) => ({
          id: s.id,
          name: s.name,
          category: s.category,
          is_default: s.is_default,
          position: s.position,
        })),
        tags: tags.map((t) => ({ id: t.id, name: t.name, color: t.color })),
        fields: fields.map((f) => ({
          id: f.id,
          name: f.name,
          type: f.type,
          project_id: f.project_id,
          options: f.options,
        })),
        relation_types: relationTypes.map((t) => ({ id: t.id, name: t.name, kind: t.kind })),
        members: members.map((m) => ({
          id: m.user_id,
          name: m.name || m.email,
          email: m.email,
          role: m.role,
        })),
        project_members:
          projectMembers?.map((m) => ({ id: m.user_id, name: m.name || m.email, role: m.role })) ?? undefined,
      });
    },
  }),
];
