#!/usr/bin/env bash
# Выкат новой версии на прод.
#
# Как вызывается: GitHub Actions ходит по SSH ключом, который прописан в
# ~root/.ssh/authorized_keys с forced command на этот скрипт, а SHA приезжает в
# SSH_ORIGINAL_COMMAND. Выполнить произвольную команду таким ключом нельзя —
# только назвать коммит, который уже лежит в репозитории. Порядок настройки —
# в docs/DEPLOY.md.
#
# Вручную с сервера:
#   /srv/secondbrain/deploy/deploy.sh v2-master
#
# Шаги выстроены так, чтобы неудача стоила как можно дешевле:
#   1) сборка образа — падение здесь не трогает ни базу, ни работающий контейнер;
#   2) миграции      — до них дело доходит, только если код собрался;
#   3) перезапуск    — с ожиданием healthcheck и возвратом на прежний образ.

set -euo pipefail

COMPOSE_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(cd "$COMPOSE_DIR/.." && pwd)"
IMAGE="secondbrain-app"
LOCKFILE="/var/lock/secondbrain-deploy.lock"
# Сборка Next съедает около 2–3 ГБ во временных файлах. Если свободного места
# меньше, сначала убираемся, иначе выкат упадёт на середине сборки.
MIN_FREE_GB=5

log() { printf '%s  %s\n' "$(date -u +%H:%M:%S)" "$*"; }
die() { printf '✗ %s\n' "$*" >&2; exit 1; }

# ---- что выкатываем ---------------------------------------------------------
TARGET="${1:-${SSH_ORIGINAL_COMMAND:-}}"
TARGET="$(printf '%s' "$TARGET" | tr -d '[:space:]')"
[ -n "$TARGET" ] || die "не указано, что выкатывать (коммит или ветка)"
# Значение уходит в аргументы git, поэтому пропускаем только то, из чего состоят
# имена веток и хеши: forced command уже не даёт выполнить команду, это второй рубеж.
case "$TARGET" in
  *[!0-9A-Za-z/._-]*) die "недопустимые символы в ссылке на коммит: $TARGET" ;;
esac

# ---- один выкат за раз ------------------------------------------------------
exec 9>"$LOCKFILE"
flock -w 900 9 || die "другой выкат ещё идёт — этот отменяю"

# ---- место на диске ---------------------------------------------------------
free_gb=$(( $(df -Pk /var/lib/docker | awk 'NR==2 {print $4}') / 1024 / 1024 ))
if [ "$free_gb" -lt "$MIN_FREE_GB" ]; then
  # Именно --aggressive: место обычно съедает свежий кеш сборки, и фильтр по
  # возрасту тут не освободил бы ничего.
  log "свободно всего ${free_gb} ГБ — убираюсь перед сборкой"
  "$COMPOSE_DIR/cleanup.sh" --aggressive || true
fi

# ---- код --------------------------------------------------------------------
cd "$REPO_DIR"
log "забираю изменения из origin"
git fetch --prune --quiet origin

SHA="$(git rev-parse --verify --quiet "${TARGET}^{commit}" \
    || git rev-parse --verify --quiet "origin/${TARGET}^{commit}")" \
  || die "коммит не найден: $TARGET"
PREVIOUS_SHA="$(git rev-parse HEAD)"

git reset --hard --quiet "$SHA"
log "выкатываю $(git log -1 --format='%h %s')"

# ---- сборка образа ----------------------------------------------------------
cd "$COMPOSE_DIR"

# Прежний образ сохраняем под тегом rollback: без тега он стал бы «висячим» и
# его унесла бы уборка в конце этого же скрипта.
HAVE_ROLLBACK=0
if docker image inspect "$IMAGE:latest" >/dev/null 2>&1; then
  docker tag "$IMAGE:latest" "$IMAGE:rollback"
  HAVE_ROLLBACK=1
fi

# cron собирается заодно: он тоже из репозитория, и правка crontab должна
# доезжать до сервера тем же выкатом, что и код. Сборка alpine+curl — секунды.
log "собираю образ"
if ! docker compose build app cron; then
  git -C "$REPO_DIR" reset --hard --quiet "$PREVIOUS_SHA"
  die "сборка упала — на сервере ничего не менялось, работает прежняя версия"
fi

# ---- миграции ---------------------------------------------------------------
if ! "$COMPOSE_DIR/migrate.sh"; then
  git -C "$REPO_DIR" reset --hard --quiet "$PREVIOUS_SHA"
  die "миграция не применилась — код не переключаю, работает прежняя версия"
fi

# ---- переключение -----------------------------------------------------------
rollback() {
  log "новая версия не отвечает — откатываюсь"
  if [ "$HAVE_ROLLBACK" = 1 ]; then
    docker tag "$IMAGE:rollback" "$IMAGE:latest"
    docker compose up -d app || true
  fi
  git -C "$REPO_DIR" reset --hard --quiet "$PREVIOUS_SHA"
  cat >&2 <<'EOF'
✗ вернул предыдущий образ.
  ВНИМАНИЕ: применённые миграции автоматически назад не откатываются.
  Снимок базы до них — deploy/backups/pre-migrate-*.pgc
EOF
  exit 1
}

set -a
# shellcheck disable=SC1091
. ./.env
set +a

log "перезапускаю приложение"
docker compose up -d --wait --wait-timeout 180 app || rollback

# Остальные контейнеры приводим в соответствие с compose-файлом: если cron
# пересобрался или caddy лежал — поднимутся здесь. Работающее без изменений
# compose не трогает.
docker compose up -d

# Healthcheck доказывает только то, что Next отвечает. Что жива связка с базой,
# показывает тик ядра: он ходит в Postgres по-настоящему. Лишний вызов безвреден —
# то же самое контейнер cron делает каждые 10 минут.
[ -n "${CRON_SECRET:-}" ] || die "в deploy/.env нет CRON_SECRET — проверить связку нечем"

smoke() {
  docker compose exec -T cron curl -fsS -m 60 -X POST \
    -H "Authorization: Bearer ${CRON_SECRET}" \
    http://app:3000/api/v2/cron >/dev/null
}

log "проверяю связку с базой"
attempt=1
until smoke; do
  if [ "$attempt" -ge 3 ]; then rollback; fi
  log "приложение ещё не отвечает, повторю через 5 секунд"
  attempt=$((attempt + 1))
  sleep 5
done

# ---- уборка -----------------------------------------------------------------
# Слои прежней сборки остались без тега — забираем их сразу, не дожидаясь
# еженедельного cleanup.sh. Образ :rollback уцелеет: у него тег есть.
#
# Кеш держим трое суток, а не неделю: одна сборка оставляет после себя порядка
# 2–3 ГБ, и при активной работе недельный запас съел бы треть диска. Трёх суток
# хватает, чтобы сборки внутри рабочего дня переиспользовали слой зависимостей.
log "убираю мусор"
docker image prune -f >/dev/null
docker builder prune -f --filter "until=72h" >/dev/null

log "готово: $(git -C "$REPO_DIR" log -1 --format='%h %s')"
docker system df 2>/dev/null || true
