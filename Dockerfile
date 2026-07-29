# syntax=docker/dockerfile:1

# Образ приложения для собственного VPS. Порядок стадий — deps → builder → runner,
# чтобы правка исходников не заставляла заново ставить зависимости.
#
# База — bookworm-slim, а не alpine: в dependencies лежит better-sqlite3 (нужен
# только скриптам в scripts/, но npm ci ставит его всегда), и prebuilt-бинарники
# у него есть под glibc, а под musl пришлось бы тянуть компилятор.

# ---- deps -------------------------------------------------------------------
FROM node:22-bookworm-slim AS deps
WORKDIR /app
# .npmrc обязателен: в нём legacy-peer-deps=true, без которого npm ci падает на
# конфликте peer-зависимостей (mcp-handler требует ровно @modelcontextprotocol/sdk
# 1.26.0, в проекте — 1.29.0). Состав пакетов при этом задаёт lock-файл, флаг лишь
# снимает проверку peer-диапазонов.
COPY package.json package-lock.json .npmrc ./
RUN npm ci

# ---- builder ----------------------------------------------------------------
FROM node:22-bookworm-slim AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# NEXT_PUBLIC_* инлайнятся в клиентский бандл во время сборки и в рантайме уже не
# читаются — поэтому они приходят build-аргументами, а не через env_file.
ARG NEXT_PUBLIC_APP_URL
ARG NEXT_PUBLIC_VAPID_PUBLIC_KEY
ENV NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL
ENV NEXT_PUBLIC_VAPID_PUBLIC_KEY=$NEXT_PUBLIC_VAPID_PUBLIC_KEY
ENV NEXT_TELEMETRY_DISABLED=1

RUN npm run build

# ---- runner -----------------------------------------------------------------
FROM node:22-bookworm-slim AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

RUN groupadd --system --gid 1001 nodejs \
 && useradd --system --uid 1001 --gid nodejs nextjs

# standalone не переносит public и .next/static — кладём их рядом с server.js,
# тогда минимальный сервер отдаёт статику сам, без отдельного CDN.
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

USER nextjs
EXPOSE 3000

# exec-форма без шелла: процесс получает SIGTERM напрямую, и Next успевает
# доработать фоновые задачи after() (дослать пуши) перед остановкой.
CMD ["node", "server.js"]
