import { getUserByEmail, upsertUser, getUserCount } from "./db";
import { createSupabaseServerClient } from "./supabase/server";
import type { UserRole } from "@/types";

export interface AuthUser {
  email: string;
  role: UserRole;
}

/**
 * Resolve the current user from the Supabase session cookie.
 * - Reads JWT from cookies via @supabase/ssr.
 * - If JWT email matches a row in `users`, returns it.
 * - First login with no users yet: bootstraps the account as admin
 *   (gated by ADMIN_BOOTSTRAP_EMAIL if set, otherwise any email).
 * - Known email in users → return role.
 * - Unknown email and not first user → null (access denied).
 */
export async function getAuthUser(): Promise<AuthUser | null> {
  const supabase = await createSupabaseServerClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user?.email) return null;

  const email = user.email.toLowerCase().trim();
  const existing = await getUserByEmail(email);
  if (existing) {
    return { email: existing.email, role: existing.role };
  }

  const bootstrap = (process.env.ADMIN_BOOTSTRAP_EMAIL ?? "").toLowerCase().trim();
  const count = await getUserCount();
  if (count === 0 && (!bootstrap || bootstrap === email)) {
    const created = await upsertUser(email, "admin", user.user_metadata?.full_name ?? "");
    return { email: created.email, role: created.role };
  }

  return null;
}
