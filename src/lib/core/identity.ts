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
  await transaction(async (tx) => {
    const changed = await tx
      .prepare(`UPDATE core.org_members SET role = ? WHERE org_id = ? AND user_id = ?`)
      .run(role, orgId, userId);
    if (changed.changes === 0) throw new DomainError(404, "Member not found");

    // Понижение до гостя обнуляет неявный доступ к org-видимым проектам, но
    // назначения продолжали бы его давать — снимаем их вместе с ролью.
    if (role === "guest") {
      await tx
        .prepare(
          `DELETE FROM core.task_assignees a USING core.tasks t
           WHERE a.task_id = t.id AND t.org_id = ? AND a.user_id = ?
             AND NOT EXISTS (
               SELECT 1 FROM core.task_projects tp
               JOIN core.project_members pm ON pm.project_id = tp.project_id AND pm.user_id = a.user_id
               WHERE tp.task_id = t.id
             )`,
        )
        .run(orgId, userId);
      await tx
        .prepare(
          `DELETE FROM core.task_followers f USING core.tasks t
           WHERE f.task_id = t.id AND t.org_id = ? AND f.user_id = ?
             AND NOT EXISTS (
               SELECT 1 FROM core.task_projects tp
               JOIN core.project_members pm ON pm.project_id = tp.project_id AND pm.user_id = f.user_id
               WHERE tp.task_id = t.id
             )`,
        )
        .run(orgId, userId);
    }
  });
}

/**
 * Удаление из организации отзывает доступ целиком: снимаются членство в
 * проектах, назначения, подписки и непрочитанные уведомления. Иначе бывший
 * сотрудник продолжает получать push с заголовками задач, а повторное
 * приглашение молча воскрешает старые проектные роли.
 */
export async function removeMember(orgId: string, userId: string): Promise<void> {
  await transaction(async (tx) => {
    const changed = await tx
      .prepare(`DELETE FROM core.org_members WHERE org_id = ? AND user_id = ?`)
      .run(orgId, userId);
    if (changed.changes === 0) throw new DomainError(404, "Member not found");

    await tx
      .prepare(
        `DELETE FROM core.project_members pm USING core.projects p
         WHERE pm.project_id = p.id AND p.org_id = ? AND pm.user_id = ?`,
      )
      .run(orgId, userId);
    await tx
      .prepare(
        `DELETE FROM core.task_assignees a USING core.tasks t
         WHERE a.task_id = t.id AND t.org_id = ? AND a.user_id = ?`,
      )
      .run(orgId, userId);
    await tx
      .prepare(
        `DELETE FROM core.task_followers f USING core.tasks t
         WHERE f.task_id = t.id AND t.org_id = ? AND f.user_id = ?`,
      )
      .run(orgId, userId);
    await tx
      .prepare(`DELETE FROM core.notifications WHERE org_id = ? AND user_id = ?`)
      .run(orgId, userId);
    // Приглашения, выписанные этим человеком и ещё не принятые, тоже отзываем:
    // выданные им гранты пережили бы его уход.
    await tx
      .prepare(
        `UPDATE core.invitations SET revoked_at = now()
         WHERE org_id = ? AND invited_by = ? AND accepted_at IS NULL AND revoked_at IS NULL`,
      )
      .run(orgId, userId);
  });
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

/** Публичный предпросмотр приглашения по сырому токену (до входа в систему). */
export async function peekInvitation(
  token: string,
): Promise<{ org_name: string; email: string; org_role: OrgRole } | null> {
  const row = await prepare<{ org_name: string; email: string; org_role: OrgRole }>(
    `SELECT o.name AS org_name, i.email, i.org_role
     FROM core.invitations i
     JOIN core.organizations o ON o.id = i.org_id
     WHERE i.token_hash = ? AND i.accepted_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > now()`,
  ).get(hashInviteToken(token));
  return row ?? null;
}

/**
 * Принятие приглашения. Токен «сгорает» атомарным UPDATE … RETURNING —
 * повторный вызов и гонка двух вкладок не создадут второго членства.
 * Email сессии обязан совпадать с адресом приглашения.
 */
export async function acceptInvitation(
  token: string,
  user: { id: string; email: string },
): Promise<{ org_id: string; org_name: string; role: OrgRole }> {
  return transaction(async (tx) => {
    const invitation = await tx
      .prepare<{
        id: string;
        org_id: string;
        email: string;
        org_role: OrgRole;
        project_grants: ProjectGrant[];
      }>(
        `UPDATE core.invitations
         SET accepted_at = now(), accepted_by = ?
         WHERE token_hash = ?
           AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > now()
           AND email = ?
         RETURNING id, org_id, email, org_role, project_grants`,
      )
      .get(user.id, hashInviteToken(token), user.email.toLowerCase().trim());

    if (!invitation) {
      // Не различаем «нет токена», «истёк» и «чужой email» — меньше информации атакующему.
      throw new DomainError(404, "Приглашение недействительно или предназначено другому адресу");
    }

    await tx
      .prepare(
        `INSERT INTO core.org_members (org_id, user_id, role)
         VALUES (?, ?, ?)
         ON CONFLICT (org_id, user_id) DO NOTHING`,
      )
      .run(invitation.org_id, user.id, invitation.org_role);

    for (const grant of invitation.project_grants) {
      // Проект мог быть удалён или уехать в другую org за время жизни инвайта.
      const project = await tx
        .prepare<{ id: string }>(`SELECT id FROM core.projects WHERE id = ? AND org_id = ?`)
        .get(grant.project_id, invitation.org_id);
      if (!project) continue;
      await tx
        .prepare(
          `INSERT INTO core.project_members (project_id, user_id, role)
           VALUES (?, ?, ?)
           ON CONFLICT (project_id, user_id) DO NOTHING`,
        )
        .run(grant.project_id, user.id, grant.role);
    }

    const org = await tx
      .prepare<{ name: string }>(`SELECT name FROM core.organizations WHERE id = ?`)
      .get(invitation.org_id);

    return {
      org_id: invitation.org_id,
      org_name: org?.name ?? "",
      role: invitation.org_role,
    };
  });
}
