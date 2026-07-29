#!/usr/bin/env bash
# Восстанавливает дамп Supabase в контейнер db. Запускать НА СЕРВЕРЕ из каталога
# deploy/ (рядом с docker-compose.yml):
#
#   scripts/db-restore-to-vps.sh supabase-20260726-120000.pgc
#
# Файл дампа должен лежать в deploy/backups/ — этот каталог примонтирован
# в контейнер как /backups.

set -euo pipefail

DUMP_NAME="${1:?Укажите имя файла дампа в deploy/backups/}"
COMPOSE_DIR="${COMPOSE_DIR:-$(dirname "$0")/../deploy}"

cd "$COMPOSE_DIR"
# shellcheck disable=SC1091
set -a; . ./.env; set +a

if [ ! -f "./backups/${DUMP_NAME}" ]; then
  echo "✗ Файл ./backups/${DUMP_NAME} не найден" >&2
  exit 1
fi

echo "→ Поднимаю базу…"
docker compose up -d db
docker compose exec -T db bash -c 'until pg_isready -q; do sleep 1; done'

# Порядок важен: 0034 создаёт роли и auth.uid(), на которые ссылаются политики
# внутри дампа. Без неё около сорока CREATE POLICY упадут при восстановлении.
echo "→ Готовлю базу: роли-заглушки, схема auth, pg_trgm (0034)…"
docker compose exec -T db psql \
  --username="$POSTGRES_USER" \
  --dbname="$POSTGRES_DB" \
  --set=ON_ERROR_STOP=1 \
  < ../supabase/migrations/0034_selfhost_compat.sql

echo "→ Восстанавливаю дамп…"
# --no-comments: в дампе есть COMMENT ON EXTENSION для расширений Supabase,
#   которых здесь нет.
# Отдельные ошибки (pg_cron, pg_net, vault) ожидаемы и не мешают — поэтому
#   без --exit-on-error.
docker compose exec -T db pg_restore \
  --username="$POSTGRES_USER" \
  --dbname="$POSTGRES_DB" \
  --no-owner \
  --no-privileges \
  --no-comments \
  "/backups/${DUMP_NAME}" || echo "⚠ pg_restore завершился с предупреждениями (см. выше)"

echo "→ Убираю функции pg_cron/pg_net (0035)…"
docker compose exec -T db psql \
  --username="$POSTGRES_USER" \
  --dbname="$POSTGRES_DB" \
  --set=ON_ERROR_STOP=1 \
  < ../supabase/migrations/0035_drop_supabase_cron.sql

echo "→ Проверяю, что данные на месте…"
docker compose exec -T db psql \
  --username="$POSTGRES_USER" \
  --dbname="$POSTGRES_DB" \
  --tuples-only \
  --command="select 'core.users: ' || count(*) from core.users
             union all select 'core.tasks: ' || count(*) from core.tasks
             union all select 'core.projects: ' || count(*) from core.projects;"

echo "✓ База готова. Дальше: docker compose up -d"
