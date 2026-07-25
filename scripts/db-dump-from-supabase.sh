#!/usr/bin/env bash
# Снимает дамп данных приложения из Supabase для переезда на свой Postgres.
#
#   SUPABASE_DB_URL='postgres://postgres.<ref>:<pass>@<host>:5432/postgres' \
#     scripts/db-dump-from-supabase.sh
#
# Берём только схемы public и core: auth, storage, realtime, vault и extensions —
# служебные схемы Supabase, на обычном Postgres они не нужны и не восстановятся.
#
# Важно: подключаться нужно к ПРЯМОМУ порту 5432, а не к пулеру 6543 —
# pgbouncer в transaction mode не поддерживает pg_dump.

set -euo pipefail

: "${SUPABASE_DB_URL:?Задайте SUPABASE_DB_URL (Dashboard → Settings → Database → Connection string → URI)}"

OUT_DIR="${OUT_DIR:-./data/backups}"
STAMP="$(date +%Y%m%d-%H%M%S)"
OUT_FILE="${OUT_DIR}/supabase-${STAMP}.pgc"

mkdir -p "$OUT_DIR"

echo "→ Снимаю дамп схем public и core…"
pg_dump "$SUPABASE_DB_URL" \
  --schema=public \
  --schema=core \
  --no-owner \
  --no-privileges \
  --format=custom \
  --file="$OUT_FILE"

echo "✓ Готово: $OUT_FILE ($(du -h "$OUT_FILE" | cut -f1))"
echo
echo "Дальше:"
echo "  1. Скопируйте файл на сервер:  scp \"$OUT_FILE\" user@server:/srv/secondbrain/deploy/backups/"
echo "  2. Восстановите:               scripts/db-restore-to-vps.sh <имя-файла>"
echo
echo "Не забудьте выгрузить вложения v1 до отключения проекта Supabase:"
echo "  npx supabase storage download --recursive ss:///attachments ./data/attachments-backup"
