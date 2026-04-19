@AGENTS.md

# Second Brain — контекст проекта

Локальный «второй мозг» для управления задачами, заметками, клиентами, недельным планированием. Только пользователь (см. `user_profile`) + опциональный мобильный доступ через Cloudflare Tunnel.

**Стек:** Next.js 16 (App Router) + React 19 + Supabase (Postgres + Auth + RLS + Storage) + shadcn/ui + Tailwind v4 + Zustand + dnd-kit + Tiptap v3 + web-push.

## Команды

```bash
npm run dev        # http://localhost:3000
npm run build
npm run lint       # flat config: eslint.config.mjs
npx tsx scripts/seed.mjs                         # сидить дефолты (категории и т.п.)
npx tsx scripts/migrate-sqlite-to-supabase.ts    # одноразовая миграция legacy SQLite → Supabase
```

Перед `npm run dev`/`build` — см. правило «безопасный билд» ниже.

## Архитектура

- `src/app/` — App Router. Маршруты:
  - `/` — kanban (десктоп), `/list`, `/planning` — недельное планирование.
  - `/m/*` — мобильный UI: `inbox`, `tasks`, `notes`, `settings`. UA-детект в `proxy.ts` редиректит мобилки сюда.
  - `/login`, `/auth/callback` — Supabase Auth.
  - `/api/*` — REST: `items`, `categories`, `tags`, `clients`, `client-statuses`, `crm-systems`, `relations`, `relation-types`, `comments`, `weekly-plans`, `staging`, `kaiten`, `notifications`, `push`, `cron`, `users`, `entity-counts`, `init`, `development-participants`, `development-stages`.
- `src/proxy.ts` — **в Next.js 16 `middleware.ts` переименован в `proxy.ts`**, экспорт называется `proxy`, а не `middleware`. Содержит Supabase-сессию, защиту путей, мобильный UA-редирект.
- `src/lib/db.ts` — единая точка доступа к данным. **База в Supabase (Postgres), не в SQLite.** `ensureDb()` оставлен как no-op для обратной совместимости; схема живёт в `supabase/migrations/`.
- `src/lib/sql.ts` — клиент `postgres` для server-side запросов; `prepare`/`exec`/`transaction`.
- `src/lib/supabase/` — server/client helpers через `@supabase/ssr` (cookie-based).
- `src/lib/auth.ts`, `src/lib/api-auth.ts` — гард API-роутов.
- `src/lib/kaiten/` — импорт из Kaiten через staging (import → staging → apply).
- `src/lib/notifications/` — web-push (VAPID): дедлайны и daily summary; cron-хендлер в `/api/cron`.
- `src/lib/store.ts` — Zustand-стор UI-состояния.
- `src/lib/storage.ts` — Supabase Storage (картинки, аватары).
- `src/components/` — `kanban/`, `list/`, `mobile/`, `kaiten/`, `clients/`, `weekly/`, `staging/`, `filters/`, `task/`, `comments/`, `relations/`, `settings/`, `ui/` (shadcn).
- `supabase/migrations/*.sql` — схема БД, RLS-политики (`0002_rls.sql`), storage-конфиг, notifications.
- `scripts/` — `seed.mjs`, одноразовый `migrate-sqlite-to-supabase.ts`.

## Non-obvious gotchas

- **Next.js 16 ≠ твои знания.** API, конвенции, файлы могут отличаться. Перед написанием роутов / server components / кешей `fetch` читай `node_modules/next/dist/docs/`. Чти deprecation-ноты.
- **`middleware.ts` → `src/proxy.ts`** (Next.js 16). Экспорт `proxy`.
- **Часовой пояс: Asia/Novosibirsk (UTC+7).** Дедлайны, отчёты, daily summary считаются в нём через `date-fns-tz`. Не используй `new Date().toLocaleString()` для пользовательских дат — только утилиты проекта.
- **RLS включён** на всех пользовательских таблицах. Серверные запросы идут под сервис-ключом через `src/lib/sql.ts`; клиентские — под сессией пользователя через `@supabase/ssr`. Не смешивай.
- **shadcn/ui + Tailwind v4**: токены и слои в `src/app/globals.css`; алиасы в `components.json`.
- **dnd-kit Sortable** — drag-and-drop на kanban и list. Не путай `@dnd-kit/core` и `@dnd-kit/sortable`.
- **Tiptap v3** — редактор заметок/комментариев (`starter-kit` + `image`, `underline`, `placeholder`).
- **Никакого AI-чата в UI.** Всё взаимодействие через VS Code / Claude Code (см. память `feedback_no_chat_in_ui`).

# Правило: уточняющие вопросы перед кодом

Когда задача связана с новым функционалом, изменением логики или архитектурными решениями — перед началом кода задай уточняющие вопросы по неясным или неоднозначным моментам. Дождись ответа и только потом приступай к реализации.

Для тривиальных задач (исправление опечаток, мелкий фикс, форматирование, простой рефакторинг) — уточнений не нужно, делай сразу.

# Правило: безопасные авто-коммиты при параллельных сессиях

## Реестр файлов сессии

Веди в памяти список всех файлов, которые ты создал или изменил в текущей сессии. Это твой **реестр**. Файлы `data/brain.db*` никогда не включай — это рантайм-артефакты.

## Когда коммитить

После каждого завершённого логического шага: добавлен роут, компонент, исправлен баг, обновлены типы + связанный код. НЕ коммить незавершённые или некомпилируемые изменения.

## Процедура коммита

1. Убедись, что реестр не пуст
2. `git status <файл>` для каждого файла из реестра — если файл не показывает изменений, сообщи: «Файл <путь> уже не содержит изменений — возможно, закоммичен другой сессией»
3. `git status --short` — если есть файлы НЕ из реестра, не трогай их. Если файл из реестра содержит изменения, которые ты не вносил — сообщи пользователю, но продолжай работу с остальными файлами
4. `git add <файл1> <файл2> ...` — только файлы из реестра. **ЗАПРЕЩЕНО:** `git add .`, `git add -A`, `git add -u`, `git commit -a`
5. `git diff --cached --name-only` — если в стейдже лишний файл, выполни `git reset HEAD <файл>`
6. `git commit -m "<тип>(<область>): <описание>"`

## Ретраи при ошибках коммита

При любой ошибке коммита (`index.lock`, конфликт, неожиданный diff) — сообщи пользователю о проблеме, но **не останавливай работу**. Продолжай разработку и повторяй попытку коммита с нарастающим интервалом: через 1 мин → 2 мин → 5 мин → 10 мин. После 4 неудачных попыток — сообщи итоговый статус и продолжай работу без коммитов до ручного вмешательства.

## Формат коммитов

`<тип>(<область>): <описание>` — типы: feat, fix, refactor, style, types, api, docs. Область — имя фичи/модуля (clients, kanban, sidebar и т.д.).

# Правило: безопасный билд при параллельных сессиях

Перед запуском `npm run build`, `next build` или `npm run dev`:

1. Проверь, не запущен ли уже процесс: `ps aux | grep -E "next (build|dev)" | grep -v grep`
2. Если процесс найден — **НЕ запускай повторно**. Сообщи: «Билд/dev-сервер уже запущен другой сессией, пропускаю»
3. Если процесс не найден — запускай как обычно

Если билд упал с ошибкой доступа к `.next/` (EBUSY, EPERM, ENOENT) — сообщи пользователю, но **не останавливайся**. Продолжай разработку и повторяй билд с нарастающим интервалом: через 1 мин → 2 мин → 5 мин → 10 мин. После 4 неудачных попыток — сообщи итоговый статус и продолжай без билда.

# Правило: не удалять файлы без явного запроса

**ЗАПРЕЩЕНО** удалять, переименовывать или перемещать существующие файлы компонентов, роутов, утилит — если пользователь явно не попросил. Если файл кажется ненужным — спроси пользователя, но не удаляй самостоятельно. Удаление файла, от которого зависят импорты, ломает билд и все API.

# Правило: миграции БД при изменении схемы (Supabase)

Схема живёт в `supabase/migrations/*.sql`. SQLite больше не используется — не трогай `initSchema`/`migrateSchema`/`better-sqlite3`.

## Когда добавляешь колонку или таблицу

1. Создай новый файл `supabase/migrations/NNNN_<имя>.sql` (следующий номер; текущий максимум — смотри `ls supabase/migrations`). Используй `CREATE TABLE IF NOT EXISTS` и `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` для идемпотентности. Добавь RLS-политики (`ENABLE ROW LEVEL SECURITY` + `CREATE POLICY`), если таблица пользовательская.
2. Применяй миграцию к удалённому Supabase через MCP: `mcp__supabase__apply_migration` (или `supabase db push`, если настроена локальная связка).
3. **Перегенерируй типы**: `mcp__supabase__generate_typescript_types` → обнови `src/types/*` (или где хранятся сгенерированные).
4. Обнови обращения в `src/lib/db.ts` и соответствующие API-роуты/компоненты.
5. Проверь, что API отдаёт 200: `curl -sS -o /dev/null -w '%{http_code}\n' http://localhost:3000/api/items`.

**Почему:** Supabase — source of truth для схемы; код приложения и типы должны совпадать с актуальным состоянием Postgres, иначе API возвращает 500.

## Атомарность изменений схемы

Изменения схемы БД, типов, API-роутов и компонентов, зависящих от новых полей — коммить **одним коммитом**. Частичный коммит (например, код ожидает колонку, а миграция не применена) приводит к 500 на всех API.
