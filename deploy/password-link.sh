#!/usr/bin/env bash
# Выдаёт одноразовую ссылку установки пароля напрямую из базы.
#
#   ./password-link.sh me@example.com
#
# Нужен ровно в двух случаях: перевести владельца на пароль сразу после выката
# (в интерфейсе такую ссылку выдаёт владелец, а первому её выдать некому) и
# отпереть организацию, если владелец забыл свой пароль. Всем остальным ссылку
# выдаёт владелец в «Настройках → Участники».
#
# Токен и его хеш считает сам Postgres: gen_random_uuid() встроен, sha256()
# встроен с PG11 — pgcrypto не требуется. Хеш совпадает с тем, что считает
# hashPasswordToken() в src/lib/core/credentials.ts: sha256 от ASCII-строки в hex.

set -euo pipefail

EMAIL="${1:-}"
[ -n "$EMAIL" ] || { echo "использование: $0 <email>" >&2; exit 2; }

COMPOSE_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$COMPOSE_DIR"
set -a
# shellcheck disable=SC1091
. ./.env
set +a

# 64 hex-символа — два uuid без дефисов, 244 бита энтропии.
TOKEN="$(docker compose exec -T db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  -v ON_ERROR_STOP=1 --quiet -tAc \
  "select replace(gen_random_uuid()::text,'-','') || replace(gen_random_uuid()::text,'-','')")"

# Прежние невыданные ссылки гасим — живой должна быть последняя, как и в UI.
USER_ID="$(docker compose exec -T db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  -v ON_ERROR_STOP=1 --quiet -tAc "
  with target as (
    select id from core.users where email = lower(trim('$EMAIL'))
  ), _burn as (
    update core.password_tokens set used_at = now()
    where user_id = (select id from target) and used_at is null
  )
  insert into core.password_tokens (user_id, token_hash, expires_at)
  select id, encode(sha256('$TOKEN'::bytea), 'hex'), now() + interval '48 hours'
  from target
  returning user_id")"

if [ -z "$USER_ID" ]; then
  echo "пользователь с адресом $EMAIL не найден в core.users" >&2
  exit 1
fi

echo "${NEXT_PUBLIC_APP_URL:-https://brain.example.com}/set-password/$TOKEN"
echo "Ссылка сработает один раз и действует двое суток." >&2
