// Проверка сессии без сетевого вызова к Supabase Auth.
//
// `auth.getUser()` на каждый запрос ходит в /auth/v1/user по сети. Проект
// подписывает JWT асимметрично (ES256), поэтому подпись проверяется локально
// через WebCrypto — `auth.getClaims()`.
//
// Ключи кэшируются здесь, а не внутри клиента Supabase: клиент создаётся заново
// на каждый запрос, его собственный кэш JWKS всегда пуст, и без внешнего кэша
// один сетевой вызов просто сменился бы другим.
//
// Безопасность: getClaims проверяет подпись и `exp`. В отличие от getUser он не
// ходит в базу за свежим состоянием пользователя — заблокированный аккаунт мог
// бы дожить до истечения токена. Для доступа это неважно: и v1 (whitelist), и v2
// (`core.org_members`) проверяют право на каждый запрос отдельным запросом к БД.

import type { SupabaseClient } from "@supabase/supabase-js";

/** Форма ключа из /.well-known/jwks.json — совпадает с JWK из @supabase/auth-js. */
interface Jwks {
  keys: Array<{
    kty: "RSA" | "EC" | "oct";
    key_ops: string[];
    alg?: string;
    kid?: string;
    [k: string]: unknown;
  }>;
}

const JWKS_TTL_MS = 10 * 60 * 1000;

let cachedJwks: Jwks | null = null;
let cachedAt = 0;
let inFlight: Promise<Jwks | null> | null = null;

async function loadJwks(): Promise<Jwks | null> {
  const now = Date.now();
  if (cachedJwks && now - cachedAt < JWKS_TTL_MS) return cachedJwks;
  // Параллельные запросы на холодном старте не должны тянуть JWKS каждый.
  if (inFlight) return inFlight;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url) return null;

  inFlight = (async () => {
    try {
      const res = await fetch(`${url}/auth/v1/.well-known/jwks.json`, {
        headers: key ? { apikey: key } : undefined,
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) return null;
      const data = (await res.json()) as Jwks;
      if (!Array.isArray(data?.keys) || data.keys.length === 0) return null;
      cachedJwks = data;
      cachedAt = Date.now();
      return data;
    } catch {
      // Сеть недоступна — вызывающий откатится на getUser().
      return null;
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

export interface SessionUser {
  id: string;
  email: string | null;
  fullName: string;
}

/**
 * Пользователь текущей сессии или null. Сначала — локальная проверка подписи,
 * при любой осечке (симметричный ключ, недоступный JWKS, битый токен) —
 * обычный сетевой `getUser()`, то есть поведение не хуже прежнего.
 */
export async function getSessionUser(supabase: SupabaseClient): Promise<SessionUser | null> {
  const jwks = await loadJwks();
  if (jwks) {
    try {
      const { data, error } = await supabase.auth.getClaims(undefined, { jwks });
      if (!error) {
        // Сессии нет — это ответ, а не сбой: сетевой фолбэк ничего не изменит.
        if (!data) return null;
        const claims = data.claims as {
          sub?: string;
          email?: string;
          user_metadata?: { full_name?: string };
        };
        if (claims?.sub) {
          return {
            id: claims.sub,
            email: claims.email ?? null,
            fullName: claims.user_metadata?.full_name ?? "",
          };
        }
      }
    } catch {
      // Падаем в фолбэк ниже.
    }
  }

  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;
  return {
    id: data.user.id,
    email: data.user.email ?? null,
    fullName: (data.user.user_metadata?.full_name as string | undefined) ?? "",
  };
}
