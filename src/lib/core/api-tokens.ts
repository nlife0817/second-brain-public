// Персональные токены доступа: выпуск, список, отзыв и разрешение запроса.
//
// Токен — это способ войти без сессии-cookie, а не отдельный субъект прав.
// Разрешённый токен собирает ровно тот же AuthContext, что построила бы сессия
// его владельца (`context.ts`), и дальше всё решает policy. Отсюда:
//
//   * отзыв членства владельца закрывает токен сам собой — чистить нечего;
//   * actor_id события указывает на человека, а не на «интеграцию вообще»;
//   * `scope: "read"` не даёт новых прав, а только сужает: такой токен не
//     допускается ни до одной мутации (`assertWritable`).
//
// Значение токена хранится только хешем. Показать его ещё раз нельзя — забыл,
// выпускай новый; это тот же контракт, что у приглашений (`hashInviteToken`).

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { prepare } from "@/lib/sql";
import { DomainError } from "./http";
import { getMembershipRole } from "./identity";
import type { ApiToken, ApiTokenScope, AuthContext, CoreUser, ProjectRole } from "./types";

/** Узнаваемый префикс: по нему видно, что за строка утекла в чужой лог. */
const TOKEN_PREFIX = "sb_";

/** Сколько символов значения показываем в списке — чтобы опознать строку. */
const VISIBLE_PREFIX_LENGTH = 12;

export function hashApiToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function generateTokenValue(): string {
  // 32 байта — 256 бит энтропии; base64url, чтобы значение переживало любой
  // конфиг-файл и заголовок без экранирования.
  return TOKEN_PREFIX + randomBytes(32).toString("base64url");
}

const TOKEN_COLUMNS = `id, org_id, user_id, name, prefix, scope, created_at, last_used_at, revoked_at`;

/**
 * Список токенов. Свои видит каждый участник, чужие — только тот, кто управляет
 * составом организации: токен действует правами владельца, поэтому его наличие
 * — вопрос администрирования доступа, а не личное дело.
 */
export async function listApiTokens(
  ctx: AuthContext,
  opts: { all?: boolean } = {},
): Promise<ApiToken[]> {
  if (opts.all) {
    return prepare<ApiToken>(
      `SELECT ${TOKEN_COLUMNS} FROM core.api_tokens
       WHERE org_id = ? AND revoked_at IS NULL
       ORDER BY created_at DESC`,
    ).all(ctx.orgId);
  }
  return prepare<ApiToken>(
    `SELECT ${TOKEN_COLUMNS} FROM core.api_tokens
     WHERE org_id = ? AND user_id = ? AND revoked_at IS NULL
     ORDER BY created_at DESC`,
  ).all(ctx.orgId, ctx.user.id);
}

export interface IssuedApiToken {
  token: ApiToken;
  /** Значение целиком. Отдаётся ровно один раз — при выпуске. */
  value: string;
}

/** Выпуск токена. Владельцем становится тот, кто его выпустил, — иначе он давал бы чужие права. */
export async function createApiToken(
  ctx: AuthContext,
  input: { name: string; scope: ApiTokenScope },
): Promise<IssuedApiToken> {
  const name = input.name.trim().slice(0, 120);
  if (!name) throw new DomainError(422, "Нужно имя токена");
  const value = generateTokenValue();
  const row = await prepare<ApiToken>(
    `INSERT INTO core.api_tokens (org_id, user_id, name, token_hash, prefix, scope)
     VALUES (?, ?, ?, ?, ?, ?)
     RETURNING ${TOKEN_COLUMNS}`,
  ).get(
    ctx.orgId,
    ctx.user.id,
    name,
    hashApiToken(value),
    value.slice(0, VISIBLE_PREFIX_LENGTH),
    input.scope,
  );
  if (!row) throw new DomainError(500, "Не удалось выпустить токен");
  return { token: row, value };
}

/**
 * Отзыв. Свой токен отзывает любой владелец, чужой — тот, кто управляет
 * составом организации: скомпрометированный токен нельзя оставлять живым
 * только потому, что его хозяин в отпуске.
 */
export async function revokeApiToken(ctx: AuthContext, tokenId: string, canManage: boolean): Promise<void> {
  const existing = await prepare<{ user_id: string }>(
    `SELECT user_id FROM core.api_tokens WHERE id = ? AND org_id = ? AND revoked_at IS NULL`,
  ).get(tokenId, ctx.orgId);
  // 404, а не 403: чужой организации не подтверждаем существование токена.
  if (!existing) throw new DomainError(404, "Токен не найден");
  if (existing.user_id !== ctx.user.id && !canManage) {
    throw new DomainError(403, "Отозвать чужой токен может только администратор");
  }
  await prepare(`UPDATE core.api_tokens SET revoked_at = now() WHERE id = ?`).run(tokenId);
}

export interface TokenAuth {
  auth: AuthContext;
  scope: ApiTokenScope;
  tokenId: string;
  tokenName: string;
}

/**
 * Токен → контекст запроса. Возвращает null на любой неудаче, не различая
 * причины: отвечать «токен есть, но организация не та» значит превратить
 * endpoint в оракул по чужим ключам.
 *
 * Сравнение хешей — `timingSafeEqual`, хотя ищем мы по индексу и «правильность»
 * уже решена базой. Дешевле оставить привычку, чем однажды сравнить строки в
 * месте, где это будет иметь значение.
 */
export async function resolveTokenAuth(rawToken: string): Promise<TokenAuth | null> {
  const token = rawToken.trim();
  if (!token.startsWith(TOKEN_PREFIX) || token.length < 20) return null;
  const hash = hashApiToken(token);

  const row = await prepare<{
    id: string;
    org_id: string;
    user_id: string;
    name: string;
    scope: ApiTokenScope;
    token_hash: string;
  }>(
    `SELECT id, org_id, user_id, name, scope, token_hash
     FROM core.api_tokens
     WHERE token_hash = ? AND revoked_at IS NULL`,
  ).get(hash);
  if (!row) return null;

  const stored = Buffer.from(row.token_hash, "hex");
  const given = Buffer.from(hash, "hex");
  if (stored.length !== given.length || !timingSafeEqual(stored, given)) return null;

  const user = await prepare<CoreUser>(`SELECT * FROM core.users WHERE id = ?`).get(row.user_id);
  if (!user) return null;

  // Права берём заново на каждый запрос: исключённый из организации владелец
  // токена не должен продолжать работать по нему.
  const orgRole = await getMembershipRole(row.org_id, row.user_id);
  if (!orgRole) return null;

  const projectRoles = await prepare<{ project_id: string; role: ProjectRole }>(
    `SELECT pm.project_id, pm.role
     FROM core.project_members pm
     JOIN core.projects p ON p.id = pm.project_id
     WHERE p.org_id = ? AND pm.user_id = ?`,
  ).all(row.org_id, row.user_id);

  return {
    auth: {
      user,
      orgId: row.org_id,
      orgRole,
      projectRoles: new Map(projectRoles.map((r) => [r.project_id, r.role])),
    },
    scope: row.scope,
    tokenId: row.id,
    tokenName: row.name,
  };
}

/**
 * Отметка использования. Пишется вне транзакции запроса и намеренно без
 * ожидания точности до секунды: это подсказка «токен ещё живой», а не аудит —
 * тот собирается из событий.
 */
export async function touchApiToken(tokenId: string): Promise<void> {
  await prepare(`UPDATE core.api_tokens SET last_used_at = now() WHERE id = ?`).run(tokenId);
}
