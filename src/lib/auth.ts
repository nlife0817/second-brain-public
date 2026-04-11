import { getUserByEmail, upsertUser, getUserCount } from "./db";
import type { UserRole } from "@/types";

const CF_EMAIL_HEADER = "cf-access-authenticated-user-email";

export interface AuthUser {
  email: string;
  role: UserRole;
}

export function getAuthUser(headers: Headers): AuthUser | null {
  let email = headers.get(CF_EMAIL_HEADER);

  if (!email) {
    email = process.env.DEV_AUTH_EMAIL || null;
  }

  if (!email) return null;

  email = email.toLowerCase().trim();

  const existing = getUserByEmail(email);
  if (existing) {
    return { email: existing.email, role: existing.role };
  }

  // First user ever → auto-create as admin
  const count = getUserCount();
  if (count === 0) {
    const user = upsertUser(email, "admin");
    return { email: user.email, role: user.role };
  }

  // Unknown email, not first user → no access
  return null;
}

export function getDevAuthUser(): AuthUser | null {
  if (process.env.NODE_ENV !== "development") return null;
  const email = process.env.DEV_AUTH_EMAIL;
  if (!email) return null;
  const role = (process.env.DEV_AUTH_ROLE as UserRole) || "admin";
  return { email, role };
}
