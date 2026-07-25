// Доступ к core.users / organizations / org_members / invitations.
// Весь SQL по идентичности и членству живёт здесь.

import { createHash, randomBytes } from "node:crypto";
import { prepare, transaction } from "@/lib/sql";
import { DomainError } from "./http";
import type {
  CoreUser,
  Invitation,
  OrgMemberWithUser,
  OrgRole,
  OrgSummary,
  Organization,
  ProjectGrant,
} from "./types";

// --- Users ---------------------------------------------------------------------

export async function getUserByAuthId(authUserId: string): Promise<CoreUser | undefined> {
  return prepare<CoreUser>(`SELECT * FROM core.users WHERE auth_user_id = ?`).get(authUserId);
}

export async function getUserByEmail(email: string): Promise<CoreUser | undefined> {
  return prepare<CoreUser>(`SELECT * FROM core.users WHERE email = ?`).get(email.toLowerCase().trim());
}

export async function getUserById(id: string): Promise<CoreUser | undefined> {
  return prepare<CoreUser>(`SELECT * FROM core.users WHERE id = ?`).get(id);
}

export async function linkAuthUser(userId: string, authUserId: string): Promise<void> {
  await prepare(`UPDATE core.users SET auth_user_id = ? WHERE id = ? AND auth_user_id IS NULL`).run(authUserId, userId);
}

export async function createUser(input: {
  email: string;
  name?: string;
  authUserId?: string | null;
}): Promise<CoreUser> {
  const row = await prepare<CoreUser>(
    `INSERT INTO core.users (email, name, auth_user_id)
     VALUES (?, ?, ?)
     ON CONFLICT (email) DO UPDATE SET
       auth_user_id = COALESCE(core.users.auth_user_id, EXCLUDED.auth_user_id),
       name = CASE WHEN core.users.name = '' THEN EXCLUDED.name ELSE core.users.name END
     RETURNING *`,
  ).get(input.email.toLowerCase().trim(), input.name ?? "", input.authUserId ?? null);
  if (!row) throw new DomainError(500, "Failed to create user");
  return row;
}

// --- Organizations & membership --------------------------------------------------

export async function getOrganization(orgId: string): Promise<Organization | undefined> {
  return prepare<Organization>(`SELECT * FROM core.organizations WHERE id = ?`).get(orgId);
}

export async function getFirstOrganization(): Promise<Organization | undefined> {
  return prepare<Organization>(`SELECT * FROM core.organizations ORDER BY created_at LIMIT 1`).get();
}

export async function getMembershipRole(orgId: string, userId: string): Promise<OrgRole | undefined> {
  const row = await prepare<{ role: OrgRole }>(
    `SELECT role FROM core.org_members WHERE org_id = ? AND user_id = ?`,
  ).get(orgId, userId);
  return row?.role;
}

export async function listUserOrgs(userId: string): Promise<OrgSummary[]> {
  return prepare<OrgSummary>(
    `SELECT o.id, o.name, o.slug, m.role
     FROM core.org_members m
     JOIN core.organizations o ON o.id = m.org_id
     WHERE m.user_id = ?
     ORDER BY o.created_at`,
  ).all(userId);
}

export async function listOrgMembers(orgId: string): Promise<OrgMemberWithUser[]> {
  return prepare<OrgMemberWithUser>(
    `SELECT m.org_id, m.user_id, m.role, m.created_at, u.email, u.name, u.avatar_url
     FROM core.org_members m
     JOIN core.users u ON u.id = m.user_id
     WHERE m.org_id = ?
     ORDER BY (m.role = 'owner') DESC, (m.role = 'admin') DESC, u.name, u.email`,
  ).all(orgId);
}

export async function addMember(orgId: string, userId: string, role: OrgRole): Promise<void> {
  await prepare(
    `INSERT INTO core.org_members (org_id, user_id, role)
     VALUES (?, ?, ?)
     ON CONFLICT (org_id, user_id) DO NOTHING`,
  ).run(orgId, userId, role);
}

// Известное упрощение: проверка "последний owner" не сериализована (нет FOR UPDATE);
// при одновременных демоушенах теоретически возможна org без owner. Для ≤50
// пользователей принято осознанно; при выходе в SaaS обернуть в транзакцию с блокировкой.
export async function countOwners(orgId: string): Promise<number> {
  const row = await prepare<{ n: number }>(
    `SELECT count(*)::int AS n FROM core.org_members WHERE org_id = ? AND role = 'owner'`,
  ).get(orgId);
  return row?.n ?? 0;
}

export async function updateMemberRole(orgId: string, userId: string, role: OrgRole): Promise<void> {
  const changed = await prepare(
    `UPDATE core.org_members SET role = ? WHERE org_id = ? AND user_id = ?`,
  ).run(role, orgId, userId);
  if (changed.changes === 0) throw new DomainError(404, "Member not found");
}

export async function removeMember(orgId: string, userId: string): Promise<void> {
  const changed = await prepare(
    `DELETE FROM core.org_members WHERE org_id = ? AND user_id = ?`,
  ).run(orgId, userId);
  if (changed.changes === 0) throw new DomainError(404, "Member not found");
}

function slugify(name: string): string {
  const translit: Record<string, string> = {
    а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z", и: "i",
    й: "i", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t",
    у: "u", ф: "f", х: "h", ц: "c", ч: "ch", ш: "sh", щ: "sch", ъ: "", ы: "y", ь: "",
    э: "e", ю: "yu", я: "ya",
  };
  const base = name
    .toLowerCase()
    .split("")
    .map((ch) => translit[ch] ?? ch)
    .join("")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return base || "org";
}

export async function createOrganization(name: string, ownerId: string): Promise<Organization> {
  return transaction(async (tx) => {
    const base = slugify(name);
    let slug = base;
    for (let i = 2; ; i++) {
      const exists = await tx.prepare(`SELECT 1 FROM core.organizations WHERE slug = ?`).get(slug);
      if (!exists) break;
      slug = `${base}-${i}`;
    }
    const org = await tx
      .prepare<Organization>(
        `INSERT INTO core.organizations (name, slug, created_by) VALUES (?, ?, ?) RETURNING *`,
      )
      .get(name, slug, ownerId);
    if (!org) throw new DomainError(500, "Failed to create organization");
    await tx
      .prepare(`INSERT INTO core.org_members (org_id, user_id, role) VALUES (?, ?, 'owner')`)
      .run(org.id, ownerId);
    const defaultStatuses: Array<[string, string, string]> = [
      ["Входящие", "#6b7280", "open"],
      ["К выполнению", "#3b82f6", "open"],
      ["В работе", "#f59e0b", "open"],
      ["Готово", "#10b981", "done"],
      ["Архив", "#9ca3af", "archived"],
    ];
    for (let i = 0; i < defaultStatuses.length; i++) {
      const [statusName, color, kind] = defaultStatuses[i];
      await tx
        .prepare(
          `INSERT INTO core.task_statuses (org_id, name, color, kind, position) VALUES (?, ?, ?, ?, ?)`,
        )
        .run(org.id, statusName, color, kind, i + 1);
    }
    return org;
  });
}

export async function updateOrganization(
  orgId: string,
  patch: { name?: string; settings?: Record<string, unknown> },
): Promise<Organization> {
  const current = await getOrganization(orgId);
  if (!current) throw new DomainError(404, "Organization not found");
  const row = await prepare<Organization>(
    `UPDATE core.organizations SET name = ?, settings = ?::jsonb WHERE id = ? RETURNING *`,
  ).get(
    patch.name ?? current.name,
    JSON.stringify(patch.settings ?? current.settings),
    orgId,
  );
  if (!row) throw new DomainError(500, "Failed to update organization");
  return row;
}

// --- Invitations -----------------------------------------------------------------

const INVITE_TTL_DAYS = 14;

export function hashInviteToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function createInvitation(input: {
  orgId: string;
  email: string;
  orgRole: Exclude<OrgRole, "owner">;
  projectGrants: ProjectGrant[];
  invitedBy: string;
}): Promise<{ invitation: Invitation; token: string }> {
  const email = input.email.toLowerCase().trim();
  const token = randomBytes(32).toString("base64url");
  const invitation = await transaction(async (tx) => {
    // Прежние неиспользованные приглашения на этот email отзываем.
    await tx
      .prepare(
        `UPDATE core.invitations SET revoked_at = now()
         WHERE org_id = ? AND email = ? AND accepted_at IS NULL AND revoked_at IS NULL`,
      )
      .run(input.orgId, email);
    const row = await tx
      .prepare<Invitation>(
        `INSERT INTO core.invitations (org_id, email, org_role, project_grants, token_hash, invited_by, expires_at)
         VALUES (?, ?, ?, ?::jsonb, ?, ?, now() + interval '${INVITE_TTL_DAYS} days')
         RETURNING id, org_id, email, org_role, project_grants, invited_by, expires_at, accepted_at, revoked_at, created_at`,
      )
      .get(
        input.orgId,
        email,
        input.orgRole,
        JSON.stringify(input.projectGrants),
        hashInviteToken(token),
        input.invitedBy,
      );
    if (!row) throw new DomainError(500, "Failed to create invitation");
    return row;
  });
  return { invitation, token };
}

export async function listInvitations(orgId: string): Promise<Invitation[]> {
  return prepare<Invitation>(
    `SELECT id, org_id, email, org_role, project_grants, invited_by, expires_at, accepted_at, revoked_at, created_at
     FROM core.invitations
     WHERE org_id = ? AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > now()
     ORDER BY created_at DESC`,
  ).all(orgId);
}

export async function revokeInvitation(orgId: string, invitationId: string): Promise<void> {
  const changed = await prepare(
    `UPDATE core.invitations SET revoked_at = now()
     WHERE id = ? AND org_id = ? AND accepted_at IS NULL AND revoked_at IS NULL`,
  ).run(invitationId, orgId);
  if (changed.changes === 0) throw new DomainError(404, "Invitation not found");
}
