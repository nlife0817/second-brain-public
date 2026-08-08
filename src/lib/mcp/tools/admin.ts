// Настройки: проекты, их участники и справочники организации.
//
// Инструменты собраны «по объекту, а не по действию» (manage_statuses с
// параметром action вместо четырёх отдельных): список инструментов модель
// читает целиком перед каждым обращением, и двадцать почти одинаковых имён в
// нём — это плата за то, чего никто не просил.

import { z } from "zod";
import { createField, deleteField, updateField } from "@/lib/core/fields";
import { DomainError } from "@/lib/core/http";
import {
  createStatus,
  createTag,
  deleteStatus,
  deleteTag,
  reorderStatuses,
  updateStatus,
  updateTag,
} from "@/lib/core/orgmeta";
import {
  createProject,
  deleteProject,
  listProjectMembers,
  removeProjectMember,
  requireProject,
  setProjectArchived,
  updateProject,
  upsertProjectMember,
} from "@/lib/core/projects";
import { reply, tool, uuid } from "../types";

const statusCategory = z.enum(["backlog", "in_progress", "done", "archived"]);
const projectRole = z.enum(["admin", "editor", "commenter", "viewer"]);
const fieldType = z.enum(["text", "number", "select", "multi_select", "date", "user", "checkbox", "url"]);

export const adminTools = [
  tool({
    name: "manage_project",
    title: "Проект",
    description:
      "Создание, правка, архивирование и удаление проекта. " +
      "default_role — базовая роль сотрудников организации; null означает закрытый проект, видимый только явным участникам.",
    write: true,
    input: z.object({
      action: z.enum(["create", "update", "archive", "unarchive", "delete"]),
      project_id: uuid.optional().describe("Для всего, кроме create"),
      name: z.string().min(1).max(200).optional(),
      description: z.string().optional(),
      color: z.string().optional(),
      icon: z.string().optional(),
      default_role: z.enum(["viewer", "commenter", "editor"]).nullish(),
    }),
    handler: async (ctx, args) => {
      if (args.action === "create") {
        if (!args.name) throw new DomainError(422, "create требует name");
        const project = await createProject(ctx, {
          name: args.name,
          description: args.description,
          color: args.color,
          icon: args.icon,
          default_role: args.default_role,
        });
        return reply({ project });
      }
      if (!args.project_id) throw new DomainError(422, `${args.action} требует project_id`);
      switch (args.action) {
        case "update": {
          const project = await updateProject(ctx, args.project_id, {
            name: args.name,
            description: args.description,
            color: args.color,
            icon: args.icon,
            default_role: args.default_role,
          });
          return reply({ project });
        }
        case "archive":
        case "unarchive":
          await setProjectArchived(ctx, args.project_id, args.action === "archive");
          return reply({ ok: true });
        default:
          await deleteProject(ctx, args.project_id);
          return reply({ ok: true });
      }
    },
  }),

  tool({
    name: "manage_project_members",
    title: "Участники проекта",
    description:
      "Состав проекта: выдать роль или исключить участника. Роль в проекте сильнее базовой роли организации; " +
      "у закрытого проекта это единственный способ дать доступ.",
    write: true,
    input: z.object({
      action: z.enum(["list", "set", "remove"]),
      project_id: uuid,
      user_id: uuid.optional(),
      role: projectRole.optional(),
    }),
    handler: async (ctx, args) => {
      if (args.action === "list") {
        // Состав отдаётся только тому, кто вправе видеть проект: сам
        // listProjectMembers прав не проверяет (как и в роуте /members).
        await requireProject(ctx, args.project_id, "project.view");
        const members = await listProjectMembers(args.project_id);
        return reply({ members: members.map((m) => ({ id: m.user_id, name: m.name || m.email, role: m.role })) });
      }
      if (!args.user_id) throw new DomainError(422, `${args.action} требует user_id`);
      if (args.action === "set") {
        if (!args.role) throw new DomainError(422, "set требует role");
        await upsertProjectMember(ctx, args.project_id, args.user_id, args.role);
      } else {
        await removeProjectMember(ctx, args.project_id, args.user_id);
      }
      return reply({ ok: true });
    },
  }),

  tool({
    name: "manage_statuses",
    title: "Статусы задач",
    description:
      "Справочник статусов организации. Категория задаёт поведение: done проставляет дату завершения, " +
      "archived прячет задачу из списков. Порядок передаётся целиком — частичный список перемешал бы справочник.",
    write: true,
    input: z.object({
      action: z.enum(["create", "update", "delete", "reorder"]),
      status_id: uuid.optional(),
      name: z.string().min(1).max(100).optional(),
      color: z.string().optional(),
      category: statusCategory.optional(),
      is_default: z.literal(true).optional().describe("Сделать статусом новых задач"),
      order: z
        .array(z.object({ id: uuid, category: statusCategory }))
        .optional()
        .describe("Для reorder: ВСЕ статусы организации по одному разу, в нужном порядке"),
    }),
    handler: async (ctx, args) => {
      switch (args.action) {
        case "create": {
          if (!args.name) throw new DomainError(422, "create требует name");
          const status = await createStatus(ctx, { name: args.name, color: args.color, category: args.category });
          return reply({ status });
        }
        case "update": {
          if (!args.status_id) throw new DomainError(422, "update требует status_id");
          const status = await updateStatus(ctx, args.status_id, {
            name: args.name,
            color: args.color,
            category: args.category,
            is_default: args.is_default,
          });
          return reply({ status });
        }
        case "delete": {
          if (!args.status_id) throw new DomainError(422, "delete требует status_id");
          await deleteStatus(ctx, args.status_id);
          return reply({ ok: true });
        }
        default: {
          if (!args.order) throw new DomainError(422, "reorder требует order");
          const statuses = await reorderStatuses(ctx, args.order);
          return reply({ statuses });
        }
      }
    },
  }),

  tool({
    name: "manage_tags",
    title: "Метки",
    description: "Справочник меток организации: создать, переименовать, удалить.",
    write: true,
    input: z.object({
      action: z.enum(["create", "update", "delete"]),
      tag_id: uuid.optional(),
      name: z.string().min(1).max(100).optional(),
      color: z.string().optional(),
    }),
    handler: async (ctx, args) => {
      if (args.action === "create") {
        if (!args.name) throw new DomainError(422, "create требует name");
        return reply({ tag: await createTag(ctx, { name: args.name, color: args.color }) });
      }
      if (!args.tag_id) throw new DomainError(422, `${args.action} требует tag_id`);
      if (args.action === "update") {
        return reply({ tag: await updateTag(ctx, args.tag_id, { name: args.name, color: args.color }) });
      }
      await deleteTag(ctx, args.tag_id);
      return reply({ ok: true });
    },
  }),

  tool({
    name: "manage_fields",
    title: "Кастомные поля",
    description:
      "Поля задач: общие для организации (project_id не задан) или свои у проекта. " +
      "Значения полей у конкретной задачи меняет update_task.",
    write: true,
    input: z.object({
      action: z.enum(["create", "update", "delete"]),
      field_id: uuid.optional(),
      name: z.string().min(1).max(100).optional(),
      type: fieldType.optional().describe("Задаётся при создании и потом не меняется"),
      project_id: uuid.nullish().describe("Поле только этого проекта; пусто — поле всей организации"),
      options: z
        .array(z.object({ id: z.string().optional(), label: z.string(), color: z.string().optional() }))
        .optional()
        .describe("Варианты для select/multiselect"),
    }),
    handler: async (ctx, args) => {
      if (args.action === "create") {
        if (!args.name || !args.type) throw new DomainError(422, "create требует name и type");
        const field = await createField(ctx, {
          name: args.name,
          type: args.type,
          project_id: args.project_id,
          options: args.options,
        });
        return reply({ field });
      }
      if (!args.field_id) throw new DomainError(422, `${args.action} требует field_id`);
      if (args.action === "update") {
        return reply({ field: await updateField(ctx, args.field_id, { name: args.name, options: args.options }) });
      }
      await deleteField(ctx, args.field_id);
      return reply({ ok: true });
    },
  }),
];
