#!/usr/bin/env bash
# Еженедельная уборка Docker.
#
# Каждый выкат оставляет после себя слои прежнего образа и кеш сборки. Сам
# deploy.sh забирает висячие слои сразу, но кеш buildx и образы под тегами так
# не уходят — за месяц частых выкатов это десятки гигабайт на диске в 47 ГБ.
#
# В системный cron ХОСТА (рядом с бэкапом, но в другой день и час):
#   sudo crontab -e
#   40 4 * * 0 /srv/secondbrain/deploy/cleanup.sh >> /var/log/secondbrain-cleanup.log 2>&1
#
# Тома не трогаем сознательно и никогда не будем: в db-data лежит вся база, и
# `docker volume prune` с неудачно подобранным флагом стоил бы её целиком.

set -euo pipefail

KEEP_HOURS="${KEEP_HOURS:-168}"

echo "── $(date -Is) ──"
docker system df

# Образы, на которые не ссылается ни один контейнер и которые старше недели.
# Работающие app/db/caddy/cron защищены своими контейнерами; под нож идут
# прошлые сборки и secondbrain-app:rollback, если за неделю не пригодился.
docker image prune -af --filter "until=${KEEP_HOURS}h"
# Кеш сборки: самая быстрорастущая часть. Свежий не трогаем — на нём держится
# скорость пересборки (без него каждый выкат заново ставил бы зависимости).
docker builder prune -af --filter "until=${KEEP_HOURS}h"
docker container prune -f --filter "until=${KEEP_HOURS}h"

echo "после уборки:"
docker system df
