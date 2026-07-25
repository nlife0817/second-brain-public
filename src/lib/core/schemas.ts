import { z } from "zod";

export const orgCreateSchema = z.object({
  name: z.string().trim().min(1).max(120),
});

export const orgPatchSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    settings: z.record(z.string(), z.unknown()).optional(),
  })
  .refine((o) => Object.keys(o).length > 0, { message: "Empty patch" });

export const memberPatchSchema = z.object({
  role: z.enum(["owner", "admin", "member", "guest"]),
});

export const projectGrantSchema = z.object({
  project_id: z.uuid(),
  role: z.enum(["admin", "editor", "commenter", "viewer"]),
});

export const invitationCreateSchema = z.object({
  email: z.email().max(254),
  org_role: z.enum(["admin", "member", "guest"]).default("member"),
  project_grants: z.array(projectGrantSchema).max(50).default([]),
});

// --- Проекты и секции -------------------------------------------------------------

export const projectCreateSchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().max(4000).optional(),
  color: z.string().trim().max(32).optional(),
  icon: z.string().trim().max(64).optional(),
  visibility: z.enum(["org", "private"]).optional(),
});

export const projectPatchSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    description: z.string().max(4000).optional(),
    color: z.string().trim().max(32).optional(),
    icon: z.string().trim().max(64).optional(),
    visibility: z.enum(["org", "private"]).optional(),
    position: z.number().finite().optional(),
    archived: z.boolean().optional(),
  })
  .refine((o) => Object.keys(o).length > 0, { message: "Empty patch" });

export const sectionCreateSchema = z.object({ name: z.string().trim().min(1).max(200) });
export const sectionPatchSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    position: z.number().finite().optional(),
  })
  .refine((o) => Object.keys(o).length > 0, { message: "Empty patch" });

export const projectMemberSchema = z.object({
  user_id: z.uuid(),
  role: z.enum(["admin", "editor", "commenter", "viewer"]).default("editor"),
});

// --- Задачи ------------------------------------------------------------------------

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");
const timeSchema = z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/, "Expected HH:MM");
const prioritySchema = z.enum(["urgent", "high", "medium", "low", "none"]);

export const taskCreateSchema = z.object({
  title: z.string().trim().min(1).max(500),
  description: z.string().max(100_000).optional(),
  status_id: z.uuid().nullish(),
  priority: prioritySchema.optional(),
  due_date: dateSchema.nullish(),
  due_time: timeSchema.nullish(),
  estimated_minutes: z.number().int().min(0).max(60_000).nullish(),
  parent_task_id: z.uuid().nullish(),
  placements: z
    .array(z.object({ project_id: z.uuid(), section_id: z.uuid().nullish() }))
    .max(20)
    .optional(),
  assignee_ids: z.array(z.uuid()).max(20).optional(),
  tag_ids: z.array(z.uuid()).max(50).optional(),
});

export const taskPatchSchema = z
  .object({
    title: z.string().trim().min(1).max(500).optional(),
    description: z.string().max(100_000).optional(),
    status_id: z.uuid().nullable().optional(),
    priority: prioritySchema.optional(),
    due_date: dateSchema.nullable().optional(),
    due_time: timeSchema.nullable().optional(),
    estimated_minutes: z.number().int().min(0).max(60_000).nullable().optional(),
    assignee_ids: z.array(z.uuid()).max(20).optional(),
    tag_ids: z.array(z.uuid()).max(50).optional(),
  })
  .refine((o) => Object.keys(o).length > 0, { message: "Empty patch" });

export const taskPlacementsSchema = z.object({
  placements: z
    .array(z.object({ project_id: z.uuid(), section_id: z.uuid().nullish() }))
    .max(20),
});

export const taskMoveSchema = z.object({
  project_id: z.uuid(),
  section_id: z.uuid().nullable().optional(),
  position: z.number().finite().optional(),
});

export const commentCreateSchema = z.object({ body: z.string().min(1).max(50_000) });

// --- Справочники и поля ---------------------------------------------------------------

export const statusCreateSchema = z.object({
  name: z.string().trim().min(1).max(100),
  color: z.string().trim().max(32).optional(),
  kind: z.enum(["open", "done", "archived"]).optional(),
});
export const statusPatchSchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    color: z.string().trim().max(32).optional(),
    kind: z.enum(["open", "done", "archived"]).optional(),
    position: z.number().finite().optional(),
  })
  .refine((o) => Object.keys(o).length > 0, { message: "Empty patch" });

export const tagCreateSchema = z.object({
  name: z.string().trim().min(1).max(100),
  color: z.string().trim().max(32).optional(),
});
export const tagPatchSchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    color: z.string().trim().max(32).optional(),
    position: z.number().finite().optional(),
  })
  .refine((o) => Object.keys(o).length > 0, { message: "Empty patch" });

export const fieldOptionSchema = z.object({
  id: z.string().max(64).optional(),
  label: z.string().trim().min(1).max(200),
  color: z.string().trim().max(32).optional(),
});

export const fieldCreateSchema = z.object({
  name: z.string().trim().min(1).max(200),
  type: z.enum(["text", "number", "select", "multi_select", "date", "user", "checkbox", "url"]),
  project_id: z.uuid().nullish(),
  options: z.array(fieldOptionSchema).max(100).optional(),
});

export const fieldPatchSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    options: z.array(fieldOptionSchema).max(100).optional(),
    position: z.number().finite().optional(),
  })
  .refine((o) => Object.keys(o).length > 0, { message: "Empty patch" });

export const fieldValueSchema = z.object({ value: z.unknown() });

export const notificationsReadSchema = z.union([
  z.object({ ids: z.array(z.uuid()).min(1).max(500) }),
  z.object({ all: z.literal(true) }),
]);
