#!/usr/bin/env bash
# Регистрирует (или показывает, или снимает) вебхук телеграм-бота.
#
#   ./telegram-webhook.sh          — зарегистрировать по APP_URL из .env
#   ./telegram-webhook.sh info     — показать, что зарегистрировано сейчас
#   ./telegram-webhook.sh delete   — снять регистрацию
#
# Разовый шаг после первого выката с ботом и после смены домена: адрес вебхука
# телеграм запоминает у себя, и сам он о переезде приложения не узнает.
#
# TELEGRAM_BOT_TOKEN и TELEGRAM_WEBHOOK_SECRET читаются из deploy/.env и в
# аргументы командной строки не попадают: та же строка иначе осела бы в истории
# оболочки и в выводе ps.

set -euo pipefail

COMPOSE_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$COMPOSE_DIR"
set -a
# shellcheck disable=SC1091
. ./.env
set +a

: "${TELEGRAM_BOT_TOKEN:?не задан в .env}"
API="https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}"

case "${1:-set}" in
  info)
    curl -sS "$API/getWebhookInfo"
    echo
    ;;
  delete)
    curl -sS -X POST "$API/deleteWebhook"
    echo
    ;;
  set)
    : "${TELEGRAM_WEBHOOK_SECRET:?не задан в .env}"
    URL="${NEXT_PUBLIC_APP_URL:-${APP_URL:?не задан в .env}}/api/v2/telegram/webhook"
    # allowed_updates ограничивает поток одними сообщениями: всё остальное
    # (изменения статуса, инлайн-запросы) боту не нужно и только шумит в логе.
    curl -sS -X POST "$API/setWebhook" \
      -H 'content-type: application/json' \
      -d "$(printf '{"url":"%s","secret_token":"%s","allowed_updates":["message"],"drop_pending_updates":true}' \
            "$URL" "$TELEGRAM_WEBHOOK_SECRET")"
    echo
    echo "Вебхук указывает на $URL" >&2
    ;;
  *)
    echo "использование: $0 [set|info|delete]" >&2
    exit 2
    ;;
esac
