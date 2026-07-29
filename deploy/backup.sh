#!/usr/bin/env bash
# Ежедневный дамп базы. Ставится в системный cron ХОСТА, а не в контейнер:
# иначе контейнеру пришлось бы отдать docker.sock, то есть root на сервере.
#
#   sudo crontab -e
#   20 3 * * * /srv/secondbrain/deploy/backup.sh >> /var/log/secondbrain-backup.log 2>&1

set -euo pipefail

COMPOSE_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKUP_DIR="${COMPOSE_DIR}/backups"
KEEP_DAYS="${KEEP_DAYS:-14}"

cd "$COMPOSE_DIR"
# shellcheck disable=SC1091
set -a; . ./.env; set +a

mkdir -p "$BACKUP_DIR"
OUT="${BACKUP_DIR}/daily-$(date +%F).pgc"

docker compose exec -T db pg_dump \
  --username="$POSTGRES_USER" \
  --format=custom \
  "$POSTGRES_DB" > "$OUT"

# Пустой файл — признак упавшего дампа; лучше упасть громко, чем хранить пустышку
# и вычистить ротацией последнюю рабочую копию.
if [ ! -s "$OUT" ]; then
  echo "✗ $(date -Is) дамп пустой, удаляю: $OUT" >&2
  rm -f "$OUT"
  exit 1
fi

find "$BACKUP_DIR" -name 'daily-*.pgc' -mtime "+${KEEP_DAYS}" -delete

echo "✓ $(date -Is) $OUT ($(du -h "$OUT" | cut -f1))"

# ВАЖНО: бэкап на том же диске не спасает от потери сервера. Раскомментируйте
# выгрузку наружу, подставив своё хранилище:
# rclone copy "$OUT" remote:secondbrain-backups/
# restic -r s3:s3.amazonaws.com/bucket backup "$OUT"
