// Команды: группировка проектов внутри организации. Управляют админы.

import { prepare } from "@/lib/sql";
import { DomainError } from "./http";
import { assertOrg } from "./policy";
import { requireProject } from "./projects";
import type { AuthContext } from "./types";

export interface Team {
  id: string;
  org_id: string;
  name: string;
  created_at: string;
  project_count: number;
}

export async function listTeams(ctx: AuthContext): Promise<Team[]> {
  // Структура организации — не для внешних подрядчиков.
  assertOrg(ctx, "crm.view");
  return prepare<Team>(
    `SELECT t.id, t.org_id, t.name, t.created_at,
            (SELECT count(*)::int FROM core.projects p
             WHERE p.team_id = t.id AND p.archived_at IS NULL) AS project_count
     FROM core.teams t WHERE t.org_id = ? ORDER BY t.name`,
  ).all(ctx.orgId);
}

export async function createTeam(ctx: AuthContext, name: string): Promise<Team> {
  assertOrg(ctx, "org.update");
  const row = await prepare<Team>(
    `INSERT INTO core.teams (org_id, name) VALUES (?, ?)
     RETURNING id, org_id, name, created_at, 0 AS project_count`,
  ).get(ctx.orgId, name);
  if (!row) throw new DomainError(500, "Failed to create team");
  return row;
}

export async function deleteTeam(ctx: AuthContext, teamId: string): Promise<void> {
  assertOrg(ctx, "org.update");
  // FK on delete set null: проекты остаются, просто теряют команду.
  const changed = await prepare(`DELETE FROM core.teams WHERE id = ? AND org_id = ?`).run(teamId, ctx.orgId);
  if (changed.changes === 0) throw new DomainError(404, "Team not found");
}

export async function setProjectTeam(
  ctx: AuthContext,
  projectId: string,
  teamId: string | null,
): Promise<void> {
  await requireProject(ctx, projectId, "project.update");
  if (teamId) {
    const team = await prepare(`SELECT 1 FROM core.teams WHERE id = ? AND org_id = ?`).get(teamId, ctx.orgId);
    if (!team) throw new DomainError(422, "Unknown team");
  }
  await prepare(`UPDATE core.projects SET team_id = ? WHERE id = ? AND org_id = ?`).run(
    teamId,
    projectId,
    ctx.orgId,
  );
}
