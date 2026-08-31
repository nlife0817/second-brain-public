// Как объекты трекера выглядят для модели.
//
// Наружу идут не строки таблиц: id вперемешку с полями бесполезен, пока не
// сходишь ещё за пятью справочниками. Поэтому у статуса, исполнителя, проекта и
// метки рядом с id всегда стоит имя — модель читает ответ, а не собирает его.
//
// Обратная сторона: имена приходится подставлять из справочников, и грузятся
// они один раз на вызов (`loadDictionaries`), а не по строке списка.

import { listProjects } from "@/lib/core/projects";
import { listStatuses, listTags } from "@/lib/core/orgmeta";
import { listOrgMembers } from "@/lib/core/identity";
import { htmlToMarkdown, htmlToText } from "./markdown";
import type {
  AuthContext,
  CoreComment,
  CoreEvent,
  CustomField,
  TaskDetail,
  TaskListItem,
} from "@/lib/core/types";

export interface Dictionaries {
  statuses: Map<string, { id: string; name: string; category: string }>;
  projects: Map<string, { id: string; name: string }>;
  tags: Map<string, { id: string; name: string }>;
  members: Map<string, { id: string; name: string; email: string }>;
}

export async function loadDictionaries(ctx: AuthContext): Promise<Dictionaries> {
  const [statuses, projects, tags, members] = await Promise.all([
    listStatuses(ctx),
    listProjects(ctx),
    listTags(ctx),
    listOrgMembers(ctx.orgId),
  ]);
  return {
    statuses: new Map(statuses.map((s) => [s.id, { id: s.id, name: s.name, category: s.category }])),
    projects: new Map(projects.map((p) => [p.id, { id: p.id, name: p.name }])),
    tags: new Map(tags.map((t) => [t.id, { id: t.id, name: t.name }])),
    members: new Map(
      members.map((m) => [m.user_id, { id: m.user_id, name: m.name || m.email, email: m.email }]),
    ),
  };
}

function named(dict: Map<string, { id: string; name: string }>, id: string | null): unknown {
  if (!id) return null;
  return dict.get(id) ?? { id, name: "недоступно" };
}

/** Строка списка: то, что видно в таблице, без описания. */
export function shapeTaskListItem(task: TaskListItem, dict: Dictionaries) {
  return {
    id: task.id,
    title: task.title,
    status: task.status_id ? named(dict.statuses, task.status_id) : null,
    priority: task.priority,
    start_date: task.start_date,
    due_date: task.due_date,
    planned_date: task.planned_date,
    completed_at: task.completed_at,
    assignees: task.assignees.map((a) => ({ id: a.id, name: a.name || a.email })),
    tags: task.tags.map((t) => t.name),
    projects: task.placements.map((p) => named(dict.projects, p.project_id)),
    parent_task_id: task.parent_task_id,
    subtasks: task.subtask_count > 0 ? `${task.subtask_done_count}/${task.subtask_count}` : null,
    comment_count: task.comment_count,
    updated_at: task.updated_at,
  };
}

/**
 * Карточка целиком. Описание отдаётся Markdown'ом, а сырой HTML — по запросу:
 * править документ модель обязана в HTML (см. markdown.ts), и без исходника
 * точечная правка превращалась бы в переписывание с нуля.
 */
export function shapeTaskDetail(
  task: TaskDetail,
  dict: Dictionaries,
  fields: CustomField[],
  opts: { html?: boolean } = {},
) {
  const fieldValues = Object.entries(task.field_values ?? {}).map(([fieldId, value]) => {
    const field = fields.find((f) => f.id === fieldId);
    return { field_id: fieldId, name: field?.name ?? "неизвестное поле", type: field?.type ?? null, value };
  });
  return {
    ...shapeTaskListItem(task, dict),
    description: htmlToMarkdown(task.description),
    description_html: opts.html ? task.description : undefined,
    description_empty: !htmlToText(task.description, 1),
    start_time: task.start_time,
    due_time: task.due_time,
    estimated_minutes: task.estimated_minutes,
    followers: task.followers.map((f) => ({ id: f.id, name: f.name || f.email })),
    creator: task.creator ? { id: task.creator.id, name: task.creator.name || task.creator.email } : null,
    fields: fieldValues,
    created_at: task.created_at,
  };
}

export function shapeComment(comment: CoreComment) {
  return {
    id: comment.id,
    author: comment.author ? comment.author.name || comment.author.email : comment.author_label,
    // Комментарий, оставленный интеграцией, помечен так же, как в интерфейсе.
    via: comment.source,
    parent_id: comment.parent_id,
    body: htmlToMarkdown(comment.body),
    created_at: comment.created_at,
    edited_at: comment.edited_at,
  };
}

export function shapeEvent(event: CoreEvent) {
  return {
    id: event.id,
    verb: event.verb,
    actor: event.actor ? event.actor.name || event.actor.email : null,
    via: event.source,
    payload: event.payload,
    created_at: event.created_at,
  };
}
