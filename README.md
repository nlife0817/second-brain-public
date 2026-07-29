# Командный трекер задач

Мультитенантное веб-приложение: организации, проекты, задачи с подзадачами и связями,
учёт времени, CRM-контур, уведомления и мобильная PWA. Next.js 16 (App Router), React 19,
TypeScript, Postgres напрямую через `postgres.js`, Tailwind v4 и Base UI.

## Разработка

```bash
npm install
npm run dev      # http://localhost:3000, уводит на /v2/my
npm run build
npm run lint
npm run test
```

Нужен `.env.local` с `DATABASE_URL` и — для входа — `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`,
`SESSION_SECRET`. Локально можно обойтись без OAuth: задайте `DEV_USER_EMAIL`, и проверка
сессии выключится (работает только при `NODE_ENV !== "production"`).

Для push дополнительно нужны `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`,
`VAPID_SUBJECT`, для фоновых задач — `CRON_SECRET`.

## Устройство

| Путь | Что там |
|---|---|
| `src/app/v2/**` | Десктопные экраны: сводный список, проекты, клиенты, время, настройки |
| `src/app/v2/m/**` | Мобильная PWA с нижним таб-баром |
| `src/app/api/v2/**` | REST API — тонкие роуты: zod → проверка прав → сервис |
| `src/lib/core/**` | Доменный слой и единственный источник правил доступа (`policy.ts`) |
| `src/lib/auth/**` | Вход через Google и подпись cookie сессии |
| `src/lib/sql.ts` | Доступ к Postgres; `prepare()` конвертит `?` → `$N` |
| `supabase/migrations/` | SQL-миграции (каталог сохранил историческое имя) |

Конвенции ядра, правила доступа и грабли, на которые уже наступали, —
в [src/lib/core/CLAUDE.md](src/lib/core/CLAUDE.md). Прочитай перед правкой домена.

## Продакшн

Собственный VPS, Docker Compose: Next.js + Postgres + Caddy + контейнер расписаний.
Push в `v2-master` выкатывается автоматически — тесты и сборка на раннере GitHub, затем
пересборка образа на сервере с откатом при неудаче.

- Автодеплой, разовая настройка и откат — [docs/DEPLOY.md](docs/DEPLOY.md)
- Конфигурация — [deploy/](deploy/), шаблон переменных — [deploy/env.example](deploy/env.example)
- Порядок первичного развёртывания и грабли — [docs/VPS-MIGRATION.md](docs/VPS-MIGRATION.md)

## Миграции

Файлы `supabase/migrations/*.sql` применяются выкатом автоматически, по одному в
транзакции; учёт — в `public._deploy_migrations`. Подробности и ручные режимы —
в [docs/DEPLOY.md](docs/DEPLOY.md).

Миграции `0001`–`0022` относятся к удалённой первой версии (персональный «второй мозг»
на схеме `public`) и оставлены как журнал.

## Фоновые задачи

Контейнер `cron` раз в 10 минут дёргает `/api/v2/cron` (Bearer `CRON_SECRET`):
push-рассылка, материализация повторяющихся правил, закрытие забытых таймеров,
доставка вебхуков. Расписание — [deploy/cron/crontab](deploy/cron/crontab).

## Документация

- [CLAUDE.md](CLAUDE.md) — стек, структура, правила работы с репозиторием
- [src/lib/core/CLAUDE.md](src/lib/core/CLAUDE.md) — архитектура ядра
