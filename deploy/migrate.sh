#!/usr/bin/env bash
# Применяет непринятые миграции из supabase/migrations/*.sql к базе в контейнере db.
#
#   ./migrate.sh             применить всё непринятое
#   ./migrate.sh --dry-run   показать, что будет применено, и выйти
#   ./migrate.sh --baseline  отметить существующие файлы применёнными, НЕ выполняя их
#
# --baseline нужен ровно один раз — когда скрипт подключают к базе, где миграции
# уже накатаны руками. Без него первый же выкат попытался бы прогнать всю историю
# с нуля поверх готовой схемы.
#
# Учёт ведётся в public._deploy_migrations по имени файла. Историческая таблица
# supabase_migrations.schema_migrations осталась от Supabase и здесь не участвует:
# в ней timestamp-версии, которые с номерами файлов никогда не совпадали.
#
# Файл, который нельзя выполнить одной транзакцией (CREATE INDEX CONCURRENTLY и
# подобное), помечается в первых строках комментарием:
#   -- deploy: no-transaction

set -euo pipefail

COMPOSE_DIR="$(cd "$(dirname "$0")" && pwd)"
MIGRATIONS_DIR="$COMPOSE_DIR/../supabase/migrations"
SNAPSHOTS_KEEP=10

MODE=apply
case "${1:-}" in
  "")         ;;
  --baseline) MODE=baseline ;;
  --dry-run)  MODE=dry ;;
  *) echo "неизвестный аргумент: $1" >&2; exit 2 ;;
esac

cd "$COMPOSE_DIR"
set -a
# shellcheck disable=SC1091
. ./.env
set +a

run_psql() {
  docker compose exec -T db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
    -v ON_ERROR_STOP=1 --quiet "$@"
}

run_psql -c "
  create table if not exists public._deploy_migrations (
    filename   text primary key,
    checksum   text not null,
    applied_at timestamptz not null default now()
  );" >/dev/null

# Список читаем в переменную, а не через `done < <(...)`. Процесс-подстановка не
# проверяется на код возврата: при недоступной базе она молча отдала бы пустой
# список, скрипт решил бы, что не применено ничего, и погнал бы всю историю
# миграций заново поверх готовой схемы.
applied_rows="$(run_psql -At -c "select filename || ' ' || checksum from public._deploy_migrations")"

declare -A APPLIED=()
while read -r name sum; do
  if [ -n "$name" ]; then APPLIED["$name"]="$sum"; fi
done <<< "$applied_rows"

# Пустой каталог — это почти наверняка сломанный checkout, а не «миграций нет».
# Молча пройти мимо здесь опаснее, чем упасть.
[ -d "$MIGRATIONS_DIR" ] || { echo "✗ нет каталога миграций: $MIGRATIONS_DIR" >&2; exit 1; }
shopt -s nullglob
files=("$MIGRATIONS_DIR"/*.sql)
shopt -u nullglob
if [ ${#files[@]} -eq 0 ]; then
  echo "✗ в $MIGRATIONS_DIR нет ни одного .sql — каталог не тот" >&2
  exit 1
fi

pending=()
for file in "${files[@]}"; do
  name="$(basename "$file")"
  sum="$(sha256sum "$file" | cut -c1-64)"
  if [ -n "${APPLIED[$name]:-}" ]; then
    # Правка уже применённого файла — почти всегда ошибка: на этой базе он
    # выполнен в прежней редакции, а на чистой выполнится в новой.
    if [ "${APPLIED[$name]}" != "$sum" ]; then
      echo "⚠ $name изменился после применения — повторно НЕ выполняю" >&2
    fi
    continue
  fi
  pending+=("$file")
done

if [ ${#pending[@]} -eq 0 ]; then
  echo "миграции: новых нет"
  exit 0
fi

echo "миграции: непринятых — ${#pending[@]}"
printf '  %s\n' "${pending[@]##*/}"

if [ "$MODE" = dry ]; then
  exit 0
fi

if [ "$MODE" = baseline ]; then
  for file in "${pending[@]}"; do
    name="$(basename "$file")"
    sum="$(sha256sum "$file" | cut -c1-64)"
    run_psql -c "insert into public._deploy_migrations (filename, checksum)
                 values ('$name', '$sum') on conflict (filename) do nothing;" >/dev/null
  done
  echo "✓ отмечено применёнными без выполнения: ${#pending[@]}"
  exit 0
fi

# ---- снимок базы перед изменением схемы -------------------------------------
# Ежедневного бэкапа мало: миграция может уехать через час после него, а откатить
# ALTER TABLE нечем. Снимок стоит секунду и мегабайт.
mkdir -p ./backups
snapshot="./backups/pre-migrate-$(date -u +%Y%m%dT%H%M%SZ).pgc"
docker compose exec -T db pg_dump -U "$POSTGRES_USER" --format=custom "$POSTGRES_DB" > "$snapshot"
if [ ! -s "$snapshot" ]; then
  rm -f "$snapshot"
  echo "✗ снимок базы пустой — миграции не применяю" >&2
  exit 1
fi
echo "снимок до миграций: $snapshot ($(du -h "$snapshot" | cut -f1))"
ls -1t ./backups/pre-migrate-*.pgc 2>/dev/null | tail -n "+$((SNAPSHOTS_KEEP + 1))" | xargs -r rm -f

# ---- применение -------------------------------------------------------------
for file in "${pending[@]}"; do
  name="$(basename "$file")"
  sum="$(sha256sum "$file" | cut -c1-64)"
  record="insert into public._deploy_migrations (filename, checksum) values ('$name', '$sum');"

  if head -n 5 "$file" | grep -qiE '^-- *deploy: *no-transaction'; then
    echo "→ $name (без транзакции)"
    run_psql < "$file"
    run_psql -c "$record" >/dev/null
  else
    echo "→ $name"
    # Отметку о применении дописываем в тот же поток: либо миграция и запись о
    # ней попадают в базу вместе, либо не попадает ничего. Иначе упавший между
    # ними выкат оставил бы миграцию применённой, но «непринятой» — и следующий
    # выкат попытался бы выполнить её второй раз.
    { cat "$file"; printf '\n%s\n' "$record"; } | run_psql --single-transaction
  fi
done

echo "✓ применено миграций: ${#pending[@]}"
