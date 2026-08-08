// Доступ к паролям и одноразовым ссылкам их установки (миграция 0048).
//
// Отдельно от identity.ts намеренно: там идентичность и членство, здесь —
// секреты входа. Ни одна выборка отсюда не должна утечь в API целиком, поэтому
// хеш пароля живёт в собственном типе, а не в CoreUser.

import { createHash, randomBytes } from "node:crypto";
import { prepare, transaction } from "@/lib/sql";
import { DomainError } from "./http";

/** Двое суток: ссылку передают лично, ждать дольше незачем. */
const TOKEN_TTL_HOURS = 48;

export interface UserCredentials {
  id: string;
  email: string;
  name: string;
  password_hash: string | null;
}

/**
 * Хеш токена ссылки. Такой же sha256(hex), как у приглашений, — и такой же,
 * какой считает `deploy/password-link.sh` через `encode(sha256(...), 'hex')`:
 * скрипт выдаёт владельцу первую ссылку, когда войти в интерфейс ещё некому.
 */
export function hashPasswordToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Учётные данные по email — только для роута входа. */
export async function getCredentialsByEmail(email: string): Promise<UserCredentials | undefined> {
  return prepare<UserCredentials>(
    `SELECT id, email, name, password_hash FROM core.users WHERE email = ?`,
  ).get(email.toLowerCase().trim());
}

/** Задан ли у пользователя пароль. */
export async function hasPassword(userId: string): Promise<boolean> {
  const row = await prepare<{ set: boolean }>(
    `SELECT password_hash IS NOT NULL AS set FROM core.users WHERE id = ?`,
  ).get(userId);
  return row?.set ?? false;
}

/**
 * Ставит пароль и гасит все невыданные ссылки этого пользователя: после смены
 * пароля ранее выписанная ссылка — это чужая возможность его перезадать.
 */
export async function setPassword(userId: string, passwordHash: string): Promise<void> {
  await transaction(async (tx) => {
    const changed = await tx
      .prepare(`UPDATE core.users SET password_hash = ? WHERE id = ?`)
      .run(passwordHash, userId);
    if (changed.changes === 0) throw new DomainError(404, "Пользователь не найден");
    await tx
      .prepare(`UPDATE core.password_tokens SET used_at = now() WHERE user_id = ? AND used_at IS NULL`)
      .run(userId);
  });
}

/** Одноразовая ссылка установки пароля. Сырой токен возвращается один раз. */
export async function createPasswordToken(input: {
  userId: string;
  createdBy: string | null;
}): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await transaction(async (tx) => {
    // Прежние неиспользованные ссылки гасим: живой должна быть последняя выданная,
    // иначе отозвать ошибочно переданную ссылку невозможно.
    await tx
      .prepare(`UPDATE core.password_tokens SET used_at = now() WHERE user_id = ? AND used_at IS NULL`)
      .run(input.userId);
    await tx
      .prepare(
        `INSERT INTO core.password_tokens (user_id, token_hash, created_by, expires_at)
         VALUES (?, ?, ?, now() + interval '${TOKEN_TTL_HOURS} hours')`,
      )
      .run(input.userId, hashPasswordToken(token), input.createdBy);
  });
  return token;
}

/** Кому выписана ссылка — для экрана установки пароля до входа. */
export async function peekPasswordToken(
  token: string,
): Promise<{ email: string; name: string } | null> {
  const row = await prepare<{ email: string; name: string }>(
    `SELECT u.email, u.name
     FROM core.password_tokens t
     JOIN core.users u ON u.id = t.user_id
     WHERE t.token_hash = ? AND t.used_at IS NULL AND t.expires_at > now()`,
  ).get(hashPasswordToken(token));
  return row ?? null;
}

/**
 * Гасит ссылку и ставит пароль одной транзакцией.
 *
 * Токен «сгорает» атомарным UPDATE … RETURNING: две открытые вкладки или
 * повторная отправка формы не дадут второго использования.
 */
export async function consumePasswordToken(
  token: string,
  passwordHash: string,
  name?: string,
): Promise<{ id: string; email: string; name: string }> {
  return transaction(async (tx) => {
    const claimed = await tx
      .prepare<{ user_id: string }>(
        `UPDATE core.password_tokens SET used_at = now()
         WHERE token_hash = ? AND used_at IS NULL AND expires_at > now()
         RETURNING user_id`,
      )
      .get(hashPasswordToken(token));
    if (!claimed) throw new DomainError(404, "Ссылка недействительна или уже использована");

    const user = await tx
      .prepare<{ id: string; email: string; name: string }>(
        `UPDATE core.users
         SET password_hash = ?,
             name = CASE WHEN ? <> '' AND name = '' THEN ? ELSE name END
         WHERE id = ?
         RETURNING id, email, name`,
      )
      .get(passwordHash, name ?? "", name ?? "", claimed.user_id);
    if (!user) throw new DomainError(404, "Пользователь не найден");
    return user;
  });
}
