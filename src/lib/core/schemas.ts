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
