import { getUserByEmail, upsertUser, getUserCount } from "./db";
import { getSessionUser } from "./auth/session";
import type { UserRole } from "@/types";

export interface AuthUser {
  email: string;
  role: UserRole;
}

/**
 * Resolve the current user from the session cookie.
 * - Reads the signed session cookie (see lib/auth/session.ts).
 * - If the session email matches a row in `users`, returns it.
 * - First login with no users yet: bootstraps the account as admin
 *   (gated by ADMIN_BOOTSTRAP_EMAIL if set, otherwise any email).
 * - Known email in users → return role.
 * - Unknown email and not first user → null (access denied).
 */
export async function getAuthUser(): Promise<AuthUser | null> {
  // Local-only dev bypass — see proxy.ts for the same gate.
  // When NODE_ENV !== "production" and DEV_USER_EMAIL is set, resolve the user
  // directly by email from the `users` table, no session needed.
  const devEmail = process.env.DEV_USER_EMAIL?.toLowerCase().trim();
  if (process.env.NODE_ENV !== "production" && devEmail) {
    const existing = await getUserByEmail(devEmail);
    if (existing) return { email: existing.email, role: existing.role };
    const created = await upsertUser(devEmail, "admin", "Dev User");
    return { email: created.email, role: created.role };
  }

  const user = await getSessionUser();
  if (!user?.email) return null;

  const email = user.email.toLowerCase().trim();
  const existing = await getUserByEmail(email);
  if (existing) {
    return { email: existing.email, role: existing.role };
  }

  const bootstrap = (process.env.ADMIN_BOOTSTRAP_EMAIL ?? "").toLowerCase().trim();
  const count = await getUserCount();
  if (count === 0 && (!bootstrap || bootstrap === email)) {
    const created = await upsertUser(email, "admin", user.fullName);
    return { email: created.email, role: created.role };
  }

  return null;
}
