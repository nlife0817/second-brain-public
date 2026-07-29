# Командный трекер задач

Мультитенантное веб-приложение: организации, проекты, задачи с подзадачами и связями, учёт времени, CRM-контур, уведомления и мобильная PWA.

Стек — Next.js 16 (App Router), React 19, TypeScript, Supabase (Postgres + Auth + Realtime), Tailwind v4 и Base UI. Деплой на Vercel из ветки `master`.

## Разработка

```bash
npm install
```

Понадобится `.env.local` с доступами к Supabase:

```
DATABASE_URL=
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
NEXT_PUBLIC_VAPID_PUBLIC_KEY=
VAPID_PRIVATE_KEY=
VAPID_SUBJECT=
CRON_SECRET=
```

Дальше:

```bash
npm run dev
```

Приложение откроется на http://localhost:3000 и уведёт на `/v2/my`. Локально можно обойти вход, задав `DEV_USER_EMAIL` — тогда `proxy.ts` пропускает проверку сессии (только при `NODE_ENV !== production`).

Остальные команды:

```bash
npm run build && npm run lint && npm run test
```

## Устройство

| Путь | Что там |
|---|---|
| `src/app/v2/**` | Десктопные экраны: сводный список, проекты, клиенты, время, настройки |
| `src/app/v2/m/**` | Мобильная PWA с нижним таб-баром |
| `src/app/api/v2/**` | REST API — тонкие роуты: zod → проверка прав → сервис |
| `src/lib/core/**` | Доменный слой и единственный источник правил доступа (`policy.ts`) |
| `src/lib/sql.ts` | Доступ к Postgres; `prepare()` конвертит `?` → `$N` |
| `supabase/migrations/` | SQL-миграции |

Конвенции ядра, правила доступа и грабли, на которые уже наступали, — в [src/lib/core/CLAUDE.md](src/lib/core/CLAUDE.md). Прочитай перед правкой домена.

## Миграции

Миграции **не** применяются автоматически при деплое — это отдельный шаг:

```bash
npx supabase db push
```

Либо скопировать SQL в Supabase Dashboard → SQL Editor → Run.

Схема приложения — `core`. Миграции `0001`–`0022` относятся к удалённой первой версии (персональный «второй мозг» на схеме `public`) и оставлены как журнал: Supabase хранит применённые версии, удаление файлов даст drift.

## Фоновые задачи

`pg_cron` + `pg_net` раз в 10 минут дёргают `/api/v2/cron` (Bearer `CRON_SECRET`): push-рассылка, материализация повторяющихся правил, закрытие забытых таймеров, доставка вебхуков. Расписание — [0027_core_cron.sql](supabase/migrations/0027_core_cron.sql), секреты в Supabase Vault.
