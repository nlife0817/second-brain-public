# Переезд на собственный VPS

Уход с Vercel + Supabase Cloud на один сервер: **Next.js + Postgres + Caddy** в Docker Compose,
без единой внешней зависимости кроме Google OAuth (вход) и push-сервисов браузеров.

---

## 1. Что именно переносим

| Подсистема | Сейчас | После переезда |
|---|---|---|
| Хостинг приложения | Vercel | Docker-контейнер `app` за Caddy |
| База | Supabase Postgres | Контейнер `db` (postgres:17), том на диске |
| Вход | Supabase Auth (GoTrue) → Google | Свой OAuth-обмен + подписанная cookie |
| Файлы (вложения v1) | Supabase Storage | Не переносим — v1 заморожена (см. §7) |
| Live-обновления (v1) | Supabase Realtime | Не переносим — v1 заморожена |
| Расписания | pg_cron + pg_net + Vault | Контейнер `cron` (busybox crond + curl) |
| TLS-сертификат | Vercel | Caddy, автоматический Let's Encrypt |

**Почему не self-hosted Supabase.** Приложение ходит в базу напрямую через `postgres.js`
([src/lib/sql.ts](../src/lib/sql.ts)), а не через PostgREST. Права проверяются в TypeScript
(`policy.ts`, whitelist v1), RLS — только страховка. Из всего стека Supabase реально
используется одна функция: «какой email вошёл через Google». Поднимать ради неё десяток
контейнеров (Kong, GoTrue, PostgREST, Realtime, Storage, Studio, imgproxy) — 4 ГБ RAM
и постоянные обновления версий в обмен на ~150 строк кода.

**Почему данные не пострадают.** `core.users.id` — собственный UUID; `auth_user_id` —
nullable-ссылка на Supabase, которая заново проставляется по email при первом входе
([0023_core_foundation.sql:64](../supabase/migrations/0023_core_foundation.sql:64),
[context.ts:70](../src/lib/core/context.ts:70)). Смена системы входа не трогает ни одной
строки доменных данных.

---

## 2. Выбор сервера

**Конфигурация:** 2 vCPU / 4 ГБ RAM / 40 ГБ NVMe. Этого хватает с запасом: приложение
в простое ест ~200 МБ, Postgres — ~300 МБ.

**Провайдер.** Ключевой критерий — не цена, а доступность Google с IP сервера:
через `accounts.google.com` идёт вход, через `fcm.googleapis.com` — все push-уведомления
на Chrome и Android. Из российских дата-центров Google периодически недоступен по
диапазонам адресов, и тогда отвалятся и вход, и пуши.

- **Hetzner CX22** (~€4.5/мес, Германия/Финляндия) — рекомендуемый вариант. Латентность
  из Новосибирска ~100 мс: для трекера задач незаметно. Нужна карта не-РФ.
- **Timeweb Cloud / Aeza** (~600–900 ₽/мес) — если нужна оплата рублями. Перед покупкой
  проверьте с тестовой машины провайдера: `curl -I https://fcm.googleapis.com`.

**Сборка образа.** `next build` съедает 2–3 ГБ. На 4 ГБ вместе с Postgres это впритык:
либо добавьте 4 ГБ swap (`fallocate -l 4G /swapfile`), либо собирайте образ локально
и пушьте в registry. Второе быстрее и не роняет прод во время сборки.

**Домен.** Любой регистратор. DNS удобно держать в Cloudflare, но **в режиме DNS-only
(серое облако)** — иначе Caddy не получит сертификат, а проксирование Cloudflare буферизует
стриминг ответов.

---

## 3. Порядок работ

Пункты 1–4 делаются заранее и не требуют сервера, 5–9 — уже на VPS.

1. **Google Cloud Console** — свой OAuth-клиент (§4).
2. **Код: замена авторизации** — уходит `@supabase/ssr`, приходит свой обмен кодом.
3. **Код: заморозка v1** — отключается Realtime-подписка и загрузка вложений.
4. **Инфраструктура** — `Dockerfile`, `deploy/docker-compose.yml`, `Caddyfile`, `crontab`.
5. **Сервер** — установка Docker, firewall, DNS на IP сервера.
6. **Перенос базы** — `pg_dump` из Supabase → `pg_restore` в контейнер (§5).
7. **Первый запуск** — `docker compose up -d`, проверка входа и пушей.
8. **Переключение** — DNS на новый IP, проверка, остановка Vercel.
9. **Бэкапы** — ежедневный `pg_dump` + выгрузка за пределы сервера (§8).

---

## 4. Google OAuth: свой клиент

Раньше redirect-URI указывал на Supabase (`<project>.supabase.co/auth/v1/callback`).
Теперь — на ваш домен.

1. [Google Cloud Console](https://console.cloud.google.com/apis/credentials) → проект →
   **Create credentials → OAuth client ID → Web application**.
2. **Authorized redirect URIs:** `https://<домен>/auth/callback`
   (для локальной отладки добавьте `http://localhost:3000/auth/callback`).
3. На экране согласия (OAuth consent screen) достаточно scope `openid email profile`.
4. Полученные `Client ID` и `Client secret` кладём в `.env` как `GOOGLE_CLIENT_ID`
   и `GOOGLE_CLIENT_SECRET`.

> После переезда все пользователи разлогинятся один раз — cookie Supabase перестанет
> распознаваться. Доступ при этом сохранится: он привязан к email, а не к сессии.

---

## 5. Перенос базы

Дамп снимаем только со схем `public` и `core` — служебные схемы Supabase
(`auth`, `storage`, `realtime`, `vault`, `extensions`) на своём Postgres не нужны и
не восстановятся.

```bash
scripts/db-dump-from-supabase.sh   # снять дамп (спросит DATABASE_URL Supabase)
scripts/db-restore-to-vps.sh       # залить дамп в контейнер на сервере
```

Оба скрипта лежат в [scripts/](../scripts/) и делают ровно то, что описано ниже, —
запускать вручную не обязательно.

**Что делает дамп:**

```bash
pg_dump "$SUPABASE_URL" \
  --schema=public --schema=core \
  --no-owner --no-privileges \
  --exclude-table='public.schema_migrations' \
  --format=custom --file=dump.pgc
```

**Порядок важен** — восстановление идёт в три шага, и скрипт делает их сам:

1. [`0034_selfhost_compat.sql`](../supabase/migrations/0034_selfhost_compat.sql) —
   **до** `pg_restore`.
2. `pg_restore` — сам дамп.
3. [`0035_drop_supabase_cron.sql`](../supabase/migrations/0035_drop_supabase_cron.sql) —
   **после**.

**Подводные камни:**

- **Роли.** В дампе около сорока `CREATE POLICY … TO authenticated`. `--no-privileges`
  убирает гранты, но не политики: без ролей `anon` / `authenticated` / `service_role`
  каждая такая команда падает. Миграция `0034` заводит их как `NOLOGIN`-заглушки.
- **`auth.uid()` в RLS.** Политики из миграций 0002/0023/0032 зовут функции GoTrue.
  `0034` создаёт схему `auth` с заглушками, возвращающими `null`: политики остаются
  валидными и работают как deny-by-default, а приложение как ходило владельцем
  в обход RLS, так и ходит.
- **Расширения.** `pg_trgm` (поиск v2) создаётся в `0034` явно — из дампа схемы `public`
  он может не приехать, потому что в Supabase расширения живут в схеме `extensions`.
  `pg_cron` и `pg_net` не нужны, ошибки по ним при восстановлении ожидаемы.
- **Мёртвые функции.** `v2_cron_tick`, `invoke_notifications_dispatch`,
  `invoke_timing_watchdog` восстановятся как код (plpgsql не проверяет имена объектов
  при создании) и упадут при первом вызове. `0035` их удаляет.

---

## 6. Расписания вместо pg_cron

Раньше `pg_cron` дёргал HTTP-эндпоинты через `pg_net`, читая URL и секрет из Supabase Vault.
Теперь то же самое делает контейнер `cron` — busybox crond + curl, секрет из `.env`.

| Задача | Расписание | Эндпоинт | Статус |
|---|---|---|---|
| Ядро v2 (пуши, повторы, таймеры, вебхуки) | `*/10 * * * *` | `POST /api/v2/cron` | активна |
| Пуш за час до дедлайна (v1) | `0 * * * *` | `GET /api/notifications/dispatch?type=overdue_hour` | выключена (v1) |
| Вечерняя сводка (v1) | `0 14 * * *` | `GET /api/notifications/dispatch?type=daily_summary` | выключена (v1) |
| Watchdog таймеров (v1) | `*/15 * * * *` | `GET /api/timing/watchdog` | выключена (v1) |
| Синхронизация Kaiten | — | `/api/cron/kaiten-sync` | заморожена ранее |

Расписания v1 закомментированы в [deploy/cron/crontab](../deploy/cron/crontab) —
достаточно снять комментарий, если v1 вернут в работу.

> Время в crontab — **UTC**, как и в исходных миграциях. `0 14 * * *` = 21:00 по Новосибирску.

Основная доставка пушей от cron не зависит: `after()` в `withOrg`/`withUser` шлёт их сразу
после мутации, cron — страховка (см. [src/lib/core/CLAUDE.md](../src/lib/core/CLAUDE.md)).

---

## 7. Что происходит с v1

v1 (`/` и `/m/*`) замораживается: код остаётся на месте, но две подсистемы, завязанные
на облако, отключаются.

- **Realtime** — `RealtimeProvider` больше не монтируется. Экраны v1 работают, но не
  обновляются live: изменения видны после перезагрузки страницы.
- **Загрузка вложений** — `uploadAttachment` возвращает понятную ошибку вместо обращения
  к Supabase Storage.

⚠️ **Перед отключением проекта Supabase выгрузите бакет `attachments`** — иначе ссылки
на файлы в старых задачах и заметках v1 умрут вместе с проектом:

```bash
npx supabase storage download --recursive ss:///attachments ./attachments-backup
```

Данные v1 в схеме `public` переносятся вместе с базой и остаются доступны: v2 читает
из них whitelist (`public.users`) и подписки на пуши (`public.push_subscriptions`).

---

## 8. Бэкапы

Единственная точка невосполнимой потери — том Postgres. Минимальная схема:

```bash
# на сервере, ежедневно в 03:20 UTC (в crontab контейнера cron)
docker compose exec -T db pg_dump -U "$POSTGRES_USER" -Fc "$POSTGRES_DB" \
  > /srv/secondbrain/backups/$(date +%F).pgc
```

Бэкап на том же диске не защищает от потери сервера — раз в сутки выгружайте
наружу (`restic`/`rclone` в S3 или второй VPS). Проверяйте восстановление: бэкап,
из которого ни разу не восстанавливались, — это не бэкап.

---

## 9. Обновление приложения

```bash
cd /srv/secondbrain
git pull
docker compose build app
docker compose up -d app
```

`stop_grace_period: 30s` даёт Next.js доработать фоновые задачи `after()` (дослать пуши)
перед остановкой контейнера — см. раздел `after` в документации по self-hosting.

Миграции БД **не применяются автоматически** — это остаётся отдельным шагом, как и раньше:

```bash
docker compose exec -T db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" < supabase/migrations/00NN_name.sql
```

---

## 10. Переменные окружения

Полный список — в [deploy/env.example](../deploy/env.example). Ключевое отличие от Vercel:
`NEXT_PUBLIC_*` вшиваются в клиентский бандл **во время сборки**, поэтому передаются
build-аргументами в `docker compose build`, а не только через `.env`.

Что больше не нужно: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `DATABASE_POOL_URL` (пулер Supabase).

Что появилось: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `SESSION_SECRET`
(ключ подписи cookie сессии, 32+ байта случайных данных).
