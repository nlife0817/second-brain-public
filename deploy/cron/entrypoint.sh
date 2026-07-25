#!/bin/sh
# busybox crond запускает задания с урезанным окружением — переменные контейнера
# до них не доходят. Сохраняем нужные в файл, задания подключают его через `.`.
set -eu

: "${INTERNAL_URL:?INTERNAL_URL is not set}"
: "${CRON_SECRET:?CRON_SECRET is not set}"

cat > /etc/cron-env <<EOF
export INTERNAL_URL='${INTERNAL_URL}'
export CRON_SECRET='${CRON_SECRET}'
EOF
chmod 0600 /etc/cron-env

# -f: не уходить в фон (иначе контейнер сразу завершится)
# -d 8: лог заданий в stderr контейнера, виден в `docker compose logs cron`
exec crond -f -d 8
