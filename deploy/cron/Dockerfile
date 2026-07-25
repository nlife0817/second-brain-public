# Замена pg_cron + pg_net: busybox crond дёргает HTTP-эндпоинты приложения.
FROM alpine:3.21

RUN apk add --no-cache curl tzdata

COPY crontab /etc/crontabs/root
COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod 0600 /etc/crontabs/root && chmod +x /usr/local/bin/entrypoint.sh

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
