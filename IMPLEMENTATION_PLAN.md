# План внедрения системы планирования

> Пошаговая инструкция Claude Code на самостоятельное внедрение системы планирования. Концепция: [planning_system_concept.md](planning_system_concept.md) (V3 Released).
>
> **Стек**: Next.js 16 (App Router, `proxy.ts`), React 19, TypeScript, Supabase Postgres, Tailwind v4, Base UI, dnd-kit, Zustand, Tiptap.
>
> **Состояние на момент написания плана**:
> - Миграция `supabase/migrations/0023_planning_system.sql` **уже создана и применена**. Бóльшая часть схемы есть. План отражает реальность, а не теорию.
> - Goals-модуль (миграции 0011–0021) полностью удалён в `0022_drop_goals.sql`. Не возрождать.
> - `src/app/planning/page.tsx` — заглушка («Функционал будет доступен»), заменяется в Фазе 3.
> - `src/app/mockup/planning/` — старый прототип под предыдущую версию концепта, **не соответствует V3 Released**. Не использовать как референс, не переносить компоненты. Удаляется в Фазе 1.5.
> - `src/components/weekly/*` и `src/app/api/weekly-plans/*` + таблицы `weekly_plans`, `weekly_plan_entries`, `entry_comments` — **существующее недельное планирование некорректно**, в V3 не используется. Удаляется в Фазе 1.5.
> - `client_revenue_entries` (миграция 0020) — мёртвая таблица (зависела от удалённых goals). Заменяется на `planning_deal_payments`. Удаляется в Фазе 1.5.
>
> **Правила работы** — см. `CLAUDE.md` / `AGENTS.md`:
> - Атомарность изменений схемы БД, типов, API-роутов и компонентов — **одним коммитом** на фазу.
> - Миграции в `supabase/migrations/NNNN_<name>.sql`, не катятся автоматически — после миграции `npx supabase db push` или Dashboard → SQL Editor.
> - Безопасные авто-коммиты (реестр файлов сессии, без `git add .`).
> - Перед запуском билда проверить, не запущен ли уже.
> - Удалять файлы можно только в фазах, явно перечисляющих файлы к удалению (см. Фаза 1.5). В остальных — запрещено.

---

## Принципы для Claude Code

1. **Читай концепт перед каждой фазой.** Перед кодом — открой соответствующий раздел `planning_system_concept.md`.
2. **Single source of truth для задач — `items` с `type='task'`.** Никаких `planning_tasks`, `tasks` (такой таблицы нет).
3. **Single source of truth для клиентов — `clients` (TEXT id).** Сделки — отдельная сущность `planning_deals` с soft-FK `client_id TEXT REFERENCES clients(id) ON DELETE SET NULL`.
4. **Single-tenant модель.** Никаких `user_id UUID REFERENCES auth.users(id)` и `auth.uid()` в новых миграциях. RLS — через `public.is_allowed_user()` whitelist (см. `0006_rls_lockdown.sql`). Авторы — `actor_email TEXT` (как в `comments.author_email`).
5. **Kaiten — через существующую инфраструктуру**: `sync_profiles` + `external_entity_links` + `sync_outbox`. Не создавать параллельных таблиц card-mapping.
6. **Все API эндпоинты** — через `withAuth` из `src/lib/api-auth.ts` (или просто через `proxy.ts` для аутентифицированных). Cron-эндпоинты — `Bearer <CRON_SECRET>` + добавить в exclusions `src/proxy.ts`.
7. **Optimistic UI** — все inline-edit действия в Zustand с rollback при ошибке.
8. **Используй существующие модули**: `src/lib/sql.ts`, `src/lib/db.ts`, `src/lib/auth.ts` / `src/lib/api-auth.ts`, `src/lib/store.ts`, `src/lib/realtime.ts`, `src/lib/recurrence.ts`.
9. **Каждая фаза = коммит** с сообщением `<тип>(<область>): <описание>`. Между фазами можно открывать новую сессию Claude Code.

---

## Фаза 0. Подготовка и аудит контекста

**Цель**: убедиться, что Claude Code понял реальное состояние кода до старта.

**Действия (только чтение)**:
1. `npm run build` — текущий код должен собираться.
2. `git status` — если есть незакоммиченные изменения, спросить пользователя.
3. Прочитать `planning_system_concept.md` целиком.
4. Прочитать `supabase/migrations/0023_planning_system.sql` целиком — основа схемы.
5. Прочитать `supabase/migrations/0001_initial.sql` (создание `items`, `clients`, `sync_*`, `external_entity_links`).
6. Прочитать `supabase/migrations/0006_rls_lockdown.sql` (single-tenant модель), `0007_time_tracking.sql` (`items.estimated_minutes`).
7. Прочитать `src/lib/sql.ts`, `src/lib/db.ts`, `src/lib/api-auth.ts`, `src/proxy.ts`, `src/types/index.ts` (тип `Item`).
8. Прочитать `src/lib/kaiten/sync.ts` и `src/lib/kaiten/import.ts` — точки интеграции для board→initiative mapping.
9. Узнать актуальный номер следующей миграции через `ls supabase/migrations/`.

**Чек-лист**:
- [ ] Знаешь номер следующей миграции (ожидаемо `0024`).
- [ ] Понимаешь, что `0023` уже создал все 16 planning_* таблиц.
- [ ] Понимаешь, что `tasks` как таблицы нет — есть `items` с `type='task'`.
- [ ] Понимаешь single-tenant pattern (`is_allowed_user()`, `actor_email`).
- [ ] `npm run build` зелёный.

**Не коммитим — только чтение.**

---

## Фаза 1 (справочно, уже выполнена). Базовая схема planning_*

> ⚠️ Эта фаза **уже выполнена** через `supabase/migrations/0023_planning_system.sql`. Здесь — только справка о том, что есть, чтобы не пытаться пересоздавать.

**Что создано в 0023**:
- 16 таблиц: `planning_directions`, `planning_periods`, `planning_metrics`, `planning_metric_targets`, `planning_metric_ticks`, `planning_initiatives`, `planning_initiative_metric_link`, `planning_deals`, `planning_deal_payments`, `planning_initiative_deal_link`, `planning_initiative_client_link`, `planning_initiative_dependency`, `planning_period_initiative_link`, `planning_change_log`, `planning_settings` (singleton `id='default'`), `planning_kaiten_board_mapping`.
- Справочники: `planning_icp_segments`, `planning_replan_reasons`, `planning_metric_units` (с seed-данными).
- ALTER TABLE `items` — добавлены planning-поля: `initiative_id`, `linked_deal_id`, `planned_period_id`, `planned_date`, `estimate_hours` (будет дропнут в 1.5), `why`, `replan_reason`, `kaiten_card_id` (будет дропнут в 1.5).
- `planning_change_log.entity_id TEXT` (поддерживает и UUID, и TEXT-id `items`), `actor_email TEXT`.
- `planning_initiatives.rice_score` — GENERATED column.
- FK `planning_deals.client_id TEXT REFERENCES clients(id) ON DELETE SET NULL`.
- Unique-индексы корректные (с COALESCE для NULL-частей).

**Применять Фазу 1 заново не нужно.**

---

## Фаза 1.5. Reconciliation миграция

**Цель**: устранить конфликты дублирующих схем и подготовить почву для остальных фаз. Одной миграцией + удаление мёртвого кода.

**Файлы**:
- `supabase/migrations/0024_planning_reconciliation.sql` — новая миграция.
- Удаление каталогов/файлов (см. ниже).

### 1.5.1. SQL миграции 0024

```sql
-- 1) Дропнуть items.estimate_hours (дублирует items.estimated_minutes из 0007).
--    Часы для capacity считаем как estimated_minutes/60 на UI/API.
ALTER TABLE items DROP COLUMN IF EXISTS estimate_hours;

-- 2) Дропнуть items.kaiten_card_id (дублирует external_entity_links
--    с provider='kaiten', local_entity_type='item'). Использовать JOIN.
DROP INDEX IF EXISTS idx_items_kaiten_card;
ALTER TABLE items DROP COLUMN IF EXISTS kaiten_card_id;

-- 3) Добавить is_carryover.
ALTER TABLE items ADD COLUMN IF NOT EXISTS is_carryover BOOLEAN NOT NULL DEFAULT FALSE;
CREATE INDEX IF NOT EXISTS idx_items_is_carryover ON items (is_carryover) WHERE is_carryover = TRUE;

-- 4) Дропнуть старую недельную модель (заменяется planning_periods type='week').
DROP TABLE IF EXISTS entry_comments CASCADE;
DROP TABLE IF EXISTS weekly_plan_entries CASCADE;
DROP TABLE IF EXISTS weekly_plans CASCADE;

-- 5) Дропнуть мёртвую client_revenue_entries (заменена planning_deal_payments).
DROP TABLE IF EXISTS client_revenue_entries CASCADE;

-- 6) Расширить notifications_log.type под planning-алёрты.
ALTER TABLE notifications_log DROP CONSTRAINT IF EXISTS notifications_log_type_check;
ALTER TABLE notifications_log ADD CONSTRAINT notifications_log_type_check
  CHECK (type IN (
    'overdue_hour', 'daily_summary',
    'planning_early_warning', 'planning_kill_criteria', 'planning_capacity_overload'
  ));

-- 7) Seed категорий задач (фиксированный набор по концепту §3.6).
--    Soft-валидация в API; CHECK на items.category не вешаем, чтобы не ломать существующие данные.
INSERT INTO categories (id, name, sort_order)
VALUES
  ('development', 'Разработка', 10),
  ('sales',       'Продажи',     20),
  ('account',     'Аккаунтинг',  30),
  ('support',     'Поддержка',   40),
  ('legal',       'Юридическое', 50)
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, sort_order = EXCLUDED.sort_order;

-- 8) Опц. seed planning_settings singleton (если ещё нет).
INSERT INTO planning_settings (id)
VALUES ('default')
ON CONFLICT (id) DO NOTHING;
```

**Перед применением миграции**:
- Прочитать реальные имена колонок `categories` (`src/app/api/categories/` + `0001_initial.sql`). Если PK не `id TEXT`, а другой — адаптировать `ON CONFLICT`.
- Прочитать имя CHECK-ограничения `notifications_log_type_check` — может называться иначе.

### 1.5.2. Удаление мёртвого кода (явный запрос пользователя)

Удалить **полностью** (вместе с подпапками):
- `src/app/mockup/planning/` — старый прототип, не соответствует V3.
- `src/components/weekly/` — компоненты старого недельного планирования.
- `src/app/api/weekly-plans/` — API старого недельного планирования.

Удалить упоминания в коде (после удаления каталогов):
- Импорты `weekly_*` в `src/lib/db.ts` — снести функции `listWeeklyPlans`, `createWeeklyPlan`, `getWeeklyPlanEntries`, `addEntryComment` и т.п. (точные имена — `grep` по `weekly_plan` в `src/lib/db.ts`).
- Импорты `WeeklyView`, `WeeklyTriageView`, `WeeklyReviewTable` из `src/components/weekly/*` в страницах (`src/app/m/tasks/`, `src/app/page.tsx` если есть).
- Кнопки/ссылки на старое недельное планирование в навигации.
- Типы `WeeklyPlan*` и связанные слайсы в `src/lib/store.ts` — снести вместе со всеми мутациями и persisted state (грамотно — иначе сломается hydration).
- `useBrainStore` ссылки на старые weekly-структуры.

> ⚠️ Удаление компонентов weekly может сломать импорты в `src/app/m/tasks/` — пройтись `grep` и обновить страницы. Если страница «эта неделя» отображалась в `/m/tasks/`, временно показать «Недельное планирование переезжает в /planning/this-week» (одна строка JSX).

### 1.5.3. Чек-лист

- [ ] Миграция `0024` создана и применена.
- [ ] `weekly_plans`, `weekly_plan_entries`, `entry_comments`, `client_revenue_entries` — отсутствуют (`\d weekly_plans` в SQL Editor → not found).
- [ ] `items.estimate_hours` и `items.kaiten_card_id` — отсутствуют.
- [ ] `items.is_carryover` — есть.
- [ ] В `categories` появились 5 семантических категорий.
- [ ] Каталоги `src/app/mockup/planning/`, `src/components/weekly/`, `src/app/api/weekly-plans/` — удалены.
- [ ] `npm run build` зелёный (после правки импортов).
- [ ] Коммит: `chore(planning): reconciliation migration 0024 + drop legacy weekly + mockup`.

---

## Фаза 1.6. TS-типы + расширение `src/lib/db.ts`

**Цель**: согласовать TypeScript-модель с применённой схемой (0023+0024). Без этого все API-фазы будут компилироваться, но возвращать `undefined` на новых полях.

**Файлы**:
- `src/types/planning.ts` — **новый**. Все planning-сущности.
- `src/types/index.ts` — расширить `Item`: `initiative_id?: string | null`, `linked_deal_id?: string | null`, `planned_period_id?: string | null`, `planned_date?: string | null`, `why?: string | null`, `replan_reason?: ReplanReason | null`, `is_carryover?: boolean`.
- `src/lib/db.ts` — добавить новые домен-функции (см. ниже) + расширить существующие SELECT/INSERT/UPDATE `items` под новые поля.

### 1.6.1. Контент `src/types/planning.ts`

Экспортировать интерфейсы (поля — те, что в 0023+0024, не выдумывать):
- `PlanningDirection`, `PlanningPeriod` (с `PeriodType = 'year'|'quarter'|'month'|'week'`), `PlanningMetric` (с `MetricType = 'numeric'|'business'|'delivery'`, `MetricSource`), `PlanningMetricTarget`, `PlanningMetricTick`.
- `PlanningInitiative` (с `InitiativeType`, `InitiativeStatus`, RICE-полями, эксп.-полями), `PlanningInitiativeDependency`.
- `PlanningDeal` (с `DealStage`), `PlanningDealPayment` (с `PaymentStatus`).
- `PlanningChangeLogEntry`, `PlanningSettings`, `PlanningKaitenBoardMapping`.
- `ReplanReason` (тип = объединение кодов из seed `planning_replan_reasons`).
- Link-таблицы как `PlanningInitiativeMetricLink` и т.п.

### 1.6.2. Расширение `src/lib/db.ts`

Добавить домен-методы (по образцу существующих, через `prepare()`):
- Directions: `listDirections`, `getDirection`, `createDirection`, `updateDirection`, `deleteDirection`.
- Periods: `listPeriods(directionId, filter?)`, `getPeriod`, `upsertPeriod`, `updateRetrospective`.
- Metrics: `listMetrics(directionId)`, `getMetric`, `createMetric`, `updateMetric`, `deleteMetric`, `addMetricTick`, `listMetricTicks(metricId, range)`.
- MetricTargets: `listMetricTargets(metricId)`, `bulkUpsertMetricTargets`.
- Initiatives: `listInitiatives(filter)`, `getInitiative`, `createInitiative`, `updateInitiative`, `linkInitiativeToMetric`, `unlinkInitiativeFromMetric`, `linkInitiativeToDeal`, `linkInitiativeToClient`, `addDependency`, `removeDependency`.
- Deals: `listDeals(filter)`, `getDeal`, `createDeal`, `updateDeal`, `listDealPayments`, `addDealPayment`, `updatePaymentStatus`.
- ChangeLog: `appendChangeLog(entry)`, `listChangeLog(filter, limit, offset)`.
- Settings: `getPlanningSettings`, `updatePlanningSettings`.
- Kaiten mapping: `listBoardMappings`, `upsertBoardMapping`, `deleteBoardMapping`.

Обновить **существующие** методы по `items`:
- `createItem`, `updateItem`, `getItem`, `listItems` — должны принимать/возвращать новые поля.
- Везде, где `items.estimated_minutes` уже используется, оставить как есть (часы UI считает на месте).

### 1.6.3. Чек-лист

- [ ] `src/types/planning.ts` создан, экспортирует все интерфейсы.
- [ ] `Item` в `src/types/index.ts` расширен.
- [ ] `src/lib/db.ts` содержит домен-методы для всех planning-сущностей.
- [ ] `npm run build` зелёный.
- [ ] Коммит: `types(planning): typescript model + db.ts methods aligned with 0023+0024`.

---

## Фаза 2. API эндпоинты + Kaiten board mapping hook + cron

**Цель**: CRUD-эндпоинты для всех сущностей + смартовый changelog + cron для рекуррентных платежей.

**Файлы (новые)**:
- `src/app/api/planning/directions/route.ts` + `[id]/route.ts`
- `src/app/api/planning/periods/route.ts` + `[id]/route.ts` + `[id]/retrospective/route.ts` + `[id]/retrospective/prefill/route.ts`
- `src/app/api/planning/metrics/route.ts` + `[id]/route.ts`
- `src/app/api/planning/metrics/[id]/targets/route.ts` (GET, bulk PATCH) + `targets/distribute/route.ts` (POST)
- `src/app/api/planning/metrics/[id]/ticks/route.ts` (GET, POST)
- `src/app/api/planning/initiatives/route.ts` + `[id]/route.ts` + `[id]/dependencies/route.ts` + `[id]/promote-from-task/route.ts`
- `src/app/api/planning/deals/route.ts` + `[id]/route.ts` + `[id]/payments/route.ts`
- `src/app/api/planning/changelog/route.ts`
- `src/app/api/planning/settings/route.ts`
- `src/app/api/planning/this-week/route.ts` (агрегат)
- `src/app/api/planning/digest/route.ts` (агрегат для Сводки)
- `src/app/api/planning/blocked-deals/route.ts` (агрегат)
- `src/app/api/planning/kaiten-mapping/route.ts` — управление `planning_kaiten_board_mapping`
- `src/app/api/cron/planning/recurring-payments/route.ts` — pg_cron target
- `src/app/api/cron/planning/early-warning/route.ts` — pg_cron target (раннее предупреждение)
- `src/app/api/integrations/grafana/tick/route.ts` — Grafana webhook (`Bearer <GRAFANA_WEBHOOK_SECRET>`)
- `src/lib/planning-changelog.ts` — middleware-хелпер `logChange()` + `suggestReplanReason()`.
- `src/lib/planning-distribute.ts` — алгоритмы кривых auto-distribute.
- `supabase/migrations/0025_planning_cron.sql` — pg_cron расписания.

**Файлы (расширение)**:
- `src/lib/kaiten/sync.ts` (или `import.ts`) — добавить hook: при upsert `items` от Kaiten проверять `planning_kaiten_board_mapping` по `remote_board_id` и проставлять `items.initiative_id`, если ещё null.
- `src/proxy.ts` — добавить в matcher exclusions: `api/cron/planning/recurring-payments`, `api/cron/planning/early-warning`, `api/integrations/grafana/tick`.

### 2.1. Auto-distribute

`POST /api/planning/metrics/[id]/targets/distribute` body: `{ curve, year_target, period_type? }`. Возвращает массив `[{ period_id, target_value }]` и сохраняет в `planning_metric_targets`.

Кривые (`src/lib/planning-distribute.ts`):
- `linear`: `target / N`.
- `s_curve`: sigmoid `1 / (1 + exp(-k(x - N/2)))`, k=4, нормализация суммы к target.
- `front_loaded`: 40/35/25 по третям.
- `back_loaded`: 20/30/50 по третям.
- `custom`: no-op (UI рисует ручной ввод).

### 2.2. Cron эндпоинты + миграция 0025

`src/app/api/cron/planning/recurring-payments/route.ts`:
1. Найти `planning_deals` со `stage='production'` и `min_monthly_amount > 0`.
2. Для каждой — проверить, есть ли запись `planning_deal_payments` на текущий месяц со `status='expected'` или `confirmed`.
3. Если нет — создать со `status='expected'`, `paid_at = make_date(YYYY, MM, day_of_production_start)`, `amount = min_monthly_amount`.

`src/app/api/cron/planning/early-warning/route.ts`:
1. Найти инициативы со `status != 'done'`, `due_period.end_date - NOW() <= early_warning_weeks * 7`.
2. Посчитать прогресс (done-задачи / всего задач инициативы).
3. Если прогресс < 80% и время < early_warning_weeks — вставить запись в `notifications_log` с `type='planning_early_warning'`.

Аутентификация: `Authorization: Bearer ${process.env.CRON_SECRET}`. Возврат 401 при несовпадении.

`supabase/migrations/0025_planning_cron.sql` — по образцу `0005_notifications_cron.sql`:
```sql
SELECT cron.schedule(
  'planning-recurring-payments', '0 3 * * *',
  $$ SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='app_url') || '/api/cron/planning/recurring-payments',
    headers := jsonb_build_object('Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='cron_secret'))
  ) $$
);

SELECT cron.schedule(
  'planning-early-warning', '0 9 * * MON',
  $$ ...аналогично, на /api/cron/planning/early-warning... $$
);
```

### 2.3. Stage transition auto-fill (в `PATCH /api/planning/deals/[id]`)

При смене `stage`:
- `lead → pilot`: если `pilot_started_at IS NULL` — заполнить `NOW()`; `pilot_planned_end_at = pilot_started_at + (pilot_default_duration_days || planning_settings.pilot_default_duration_days || 60) days`.
- `pilot → production`: если `production_started_at IS NULL` — `NOW()`.
- Всегда: `stage_changed_at = NOW()`.

### 2.4. Change log middleware

`src/lib/planning-changelog.ts` экспортирует:
- `logChange({ entityType, entityId, action, diff, replanReason?, actorEmail })` — INSERT в `planning_change_log`.
- `suggestReplanReason(diff)` — эвристика (см. §6.7.6 концепта).
- Минорные правки: `target_value` и `Math.abs((new - old) / old) < planning_settings.minor_adjustment_threshold` → `replan_reason = { code: 'minor_adjustment' }` без диалога.

Вызывать `logChange()` из всех мутирующих эндпоинтов (PATCH/POST/DELETE).

### 2.5. Kaiten hook (board → initiative)

В `src/lib/kaiten/sync.ts` после успешного upsert `items` от удалённой стороны:
1. Считать `remote_board_id` из импортируемой карточки.
2. `SELECT initiative_id FROM planning_kaiten_board_mapping WHERE kaiten_board_id = ?`.
3. Если найден и `items.initiative_id IS NULL` — UPDATE `items.initiative_id`.
4. Не перезатирать руками выставленную привязку.

### 2.6. Чек-лист

- [ ] Все эндпоинты возвращают валидный JSON, `withAuth` на всех кроме cron/webhook.
- [ ] Cron + webhook в `proxy.ts` exclusions.
- [ ] `0025_planning_cron.sql` создана и применена (расписания в `cron.job`).
- [ ] Auto-distribute линейная и S-кривая дают корректные суммы (== target ± 1).
- [ ] `logChange()` пишет в `planning_change_log` при каждом PATCH.
- [ ] Kaiten-hook проставляет `items.initiative_id` при импорте карточки с замапленной доски.
- [ ] Коммит: `feat(planning): api endpoints, changelog, kaiten hook, cron schedule`.

---

## Фаза 3. UI базовый layout + Колонки (Метрика → Инициатива → Задача)

**Цель**: рабочий `/planning` с тремя Miller-колонками. Strict V3 Released, без переноса из `/mockup/planning/`.

> Старый мокап удалён в Фазе 1.5. Все компоненты — с нуля по концепту §20.

**Файлы**:
- Заменить `src/app/planning/page.tsx` (был stub) → `redirect('/planning/columns')`.
- `src/app/planning/layout.tsx` — chrome с навигацией (Колонки / Эта неделя / Этот месяц / Этот квартал / Roadmap / Сводка / Сделки / Журнал / Настройки).
- `src/app/planning/columns/page.tsx`.
- `src/components/planning/MetricColumn.tsx`, `InitiativeColumn.tsx`, `TaskColumn.tsx`.
- `src/components/planning/MetricCard.tsx`, `InitiativeCard.tsx`, `TaskCard.tsx`.
- `src/components/planning/CreateMetricDrawer.tsx`, `CreateInitiativeDrawer.tsx`, `CreateTaskDrawer.tsx`.
- `src/components/planning/InlineTextField.tsx`, `InlineNumberField.tsx`, `InlineDateField.tsx`, `InlineSelectField.tsx`.
- `src/lib/planning-store.ts` — Zustand store (отдельный от `useBrainStore`), optimistic mutations + rollback.

### 3.1. Зависимости

```bash
npm install sonner recharts react-hook-form @hookform/resolvers zod
```

Глобальный `<Toaster />` (sonner) — в `src/app/planning/layout.tsx` (или в root, если ещё нет).

### 3.2. Реализация

- 3 колонки с фиксированной шириной (см. §20.2.1 концепта). Выделенная карточка слева подсвечивает связанные справа.
- Inline edit title карточек: `<InlineTextField value={title} onSave={...}>`. На blur/Enter — POST patch + optimistic + rollback на ошибке + sonner toast.
- Sparkline на метрике — Recharts mini `<LineChart>` 80×24 без осей/тиков.
- Sort tabs на колонке инициатив: «По дедлайну» / «По RICE».
- Auto-archive фильтр: инициативы `status='done'` старше 30 дней скрыты по умолчанию; toggle «Архив виден».
- Empty state каждой колонки — CTA + объяснение (см. §20.1.4).
- Right-side drawer для деталей карточки (Base UI `Dialog` с правым позиционированием) — карточка инициативы со всеми полями + список задач + связи с метриками/сделками.

### 3.3. Чек-лист

- [ ] `/planning` редиректит на `/planning/columns`.
- [ ] 3 колонки рендерятся, выделение каскадно подсвечивает связанные.
- [ ] Drawer создания каждой сущности работает.
- [ ] Inline edit title с optimistic UI + rollback на ошибке.
- [ ] Sparkline на метрике видна (или skeleton при пустых ticks).
- [ ] Sort tabs работают.
- [ ] Auto-archive фильтр работает.
- [ ] Коммит: `feat(planning): columns view with inline edit`.

---

## Фаза 4. Страница метрики + auto-distribute UI

**Цель**: `/planning/metrics/[id]` с графиком, целями и кривыми.

**Файлы**:
- `src/app/planning/metrics/[id]/page.tsx`.
- `src/components/planning/MetricChart.tsx` — Recharts LineChart (plan + fact, для Бизнес-метрик ещё «virtual fact»).
- `src/components/planning/MetricTargetsTable.tsx` — inline-editable таблица целей.
- `src/components/planning/AutoDistributeDialog.tsx` — выбор кривой + preview.

### 4.1. UI

Bento layout (§20.2.2):
- Левый верх: график (plan/fact/virtual).
- Правый верх: key numbers (Год / Факт / Прогноз / Gap).
- Низ слева: таблица целей по горизонтам (inline edit).
- Низ справа: источники факта (последние 10 ticks или платежей для Бизнес-метрик).
- Кнопка «↻ Re-distribute по кривой» → `AutoDistributeDialog`.
- Empty state — кнопки «Auto-distribute линейная / S-кривая / front / back».

### 4.2. AutoDistributeDialog

- Radio: Линейная / S-кривая / Front-loaded / Back-loaded / Custom (= закрыть).
- Превью — мини-Recharts.
- «Применить» → `POST /api/planning/metrics/[id]/targets/distribute`.
- Toast «N ячеек обновлено · Отменить» (sonner, 5 сек на undo — на undo делать обратный bulk PATCH с предыдущим snapshot).

### 4.3. Чек-лист

- [ ] Страница рисует график.
- [ ] Линейная distribute заполняет ячейки.
- [ ] S-кривая — превью корректное.
- [ ] Inline edit ячеек цели с optimistic UI.
- [ ] Toast undo работает.
- [ ] Коммит: `feat(planning): metric page with auto-distribute`.

---

## Фаза 5. Эта неделя + carryover (новая страница, с нуля)

**Цель**: `/planning/this-week` со sidebar + day-grid. С нуля по концепту, без `weekly_plans` (дропнута в 1.5), без `components/weekly/*` (удалены в 1.5).

**Файлы**:
- `src/app/planning/this-week/page.tsx`.
- `src/components/planning/WeekSidebar.tsx` — метрики недели + инициативы + бэклог `items` без `planned_date`.
- `src/components/planning/WeekDaysGrid.tsx` — ПН-ПТ (опц. СБ/ВС из settings) с dnd-kit.
- `src/components/planning/DayColumn.tsx`.

### 5.1. Хранение

- Период недели = строка в `planning_periods (type='week')`. Создаётся on-demand при первом открытии текущей недели.
- Запланированные задачи = `items` с `planned_period_id = <thisWeek.id>` и опц. `planned_date`.
- Carryover = `items` со статусом != 'done' и `planned_period_id = <previousWeek.id>` и `planned_date < <thisWeek.start>` → при первом открытии страницы недели API эндпоинт `GET /api/planning/this-week` переносит их: `planned_period_id = thisWeek.id`, `planned_date = thisWeek.start (ПН)`, `is_carryover = TRUE`. Помечается визуально (бейдж «↻ Перенос»).

### 5.2. UI

- Sidebar:
  - Блок «Метрики недели» — список метрик с target/fact/прогноз на неделю.
  - Блок «Инициативы недели» — карточки с прогрессом %.
  - Блок «Бэклог задач» — `items` без `planned_date` (с group by initiative).
- Day grid:
  - 5–7 колонок (по settings.work_days).
  - Drag из бэклога в день → PATCH `items` с `planned_date`.
  - Drag между днями.
  - Сумма `estimated_minutes/60` на колонке дня > `daily_capacity_hours` (из settings) → подсветка строки красным + tooltip.
- Кнопка «Сделать инициативой» на задаче — открывает `CreateInitiativeDrawer` с pre-filled title/description (см. концепт §3.8); вызывает `POST /api/planning/initiatives/[id]/promote-from-task`.

### 5.3. Чек-лист

- [ ] Страница открывается на текущей неделе (auto-create period если нет).
- [ ] Carryover работает: задачи прошлой невыполненной недели в ПН с бейджем.
- [ ] Drag из sidebar в день обновляет `planned_date`.
- [ ] Drag между днями работает.
- [ ] Перегрузка дня подсвечивает строку.
- [ ] «Сделать инициативой» создаёт инициативу и привязывает задачу.
- [ ] Коммит: `feat(planning): this-week page with day-grid and carryover`.

---

## Фаза 6. Этот месяц + Этот квартал + RetrospectiveEditor

**Цель**: страницы `/planning/this-month`, `/planning/this-quarter`.

**Файлы**:
- `src/app/planning/this-month/page.tsx`, `this-quarter/page.tsx`.
- `src/components/planning/MonthOverview.tsx`, `QuarterOverview.tsx`.
- `src/components/planning/RetrospectiveEditor.tsx`.

### 6.1. Этот месяц

- Capacity месяца vs планируемые часы.
- Инициативы с `due_period.end_date` в текущем месяце + раннее предупреждение (≤80% задач done и ≤4 нед до дедлайна).
- Цели метрик на месяц + прогноз.
- Соотношение Стратегия / Поддержка (по типу инициатив).

### 6.2. Этот квартал

- Аналогично, горизонт 3 месяца.
- В последнюю неделю квартала — блок «Заполнить ретроспективу» с кнопкой pre-fill.

### 6.3. RetrospectiveEditor

- 4 textarea: `what_went_well`, `what_didnt`, `what_to_try`, `lessons_learned`.
- Кнопка «Pre-fill из журнала» → `POST /api/planning/periods/[id]/retrospective/prefill` (агрегат change_log за период + killed-инициативы + сработавшие kill_criteria + завершённые эксперименты + minor/major переплан-категории).
- PO правит, нажимает «Сохранить» → `PATCH /api/planning/periods/[id]/retrospective`.

### 6.4. Чек-лист

- [ ] Обе страницы открываются.
- [ ] Pre-fill кнопка работает (с empty state «Нет данных за период»).
- [ ] Ретроспектива сохраняется.
- [ ] Коммит: `feat(planning): month and quarter overview + retrospective editor`.

---

## Фаза 7. Roadmap (SVAR Gantt) + зависимости

**Цель**: `/planning/roadmap` с Gantt-like view.

**Файлы**:
- `src/app/planning/roadmap/page.tsx`.
- `src/components/planning/RoadmapGantt.tsx`.

### 7.1. Установка

```bash
npm install wx-react-gantt
```

(Проверить актуальное имя пакета SVAR Gantt — `wx-react-gantt` или `@svar-ui/react-gantt`. MIT.)

### 7.2. Реализация

- Lanes: Блокер / Зрелость / Тех. долг / Эксперимент / Поддержка.
- Полосы = инициативы от `created_at` до `due_period.end_date`.
- Цвет по статусу.
- Зависимости из `planning_initiative_dependency` — стрелки.
- Drag-resize правого края → `due_period_id` через replan flow (диалог replan_reason).
- Click — открывает тот же drawer карточки инициативы из Фазы 3.
- Цепочка `parent_initiative_id` (B → B') — соединяющая линия.

### 7.3. Lazy loading

`next/dynamic` с `ssr: false` + skeleton.

### 7.4. Чек-лист

- [ ] Roadmap рендерится, полосы видны.
- [ ] Зависимости — стрелки.
- [ ] Drag-resize меняет дедлайн с replan-диалогом.
- [ ] Click открывает drawer.
- [ ] Коммит: `feat(planning): roadmap with svar gantt`.

---

## Фаза 8. Сделки + платежи + Заблокированные сделки

**Цель**: CRUD сделок (`planning_deals` уже есть), UI платежей, страница `/planning/blocked-deals`.

> Cron `planning-recurring-payments` уже настроен в Фазе 2 (миграция 0025).

**Файлы**:
- `src/app/planning/deals/page.tsx` + `[id]/page.tsx`.
- `src/app/planning/blocked-deals/page.tsx`.
- `src/components/planning/DealsList.tsx`, `DealDetail.tsx`, `DealStageEditor.tsx`, `DealPaymentsList.tsx`, `BlockedDealsList.tsx`.

### 8.1. UI сделок

- Список: Название / Клиент / Сегмент / Этап / Дата перехода / `min_monthly_amount` / Сумма платежей за период.
- Inline-edit этапа — backend auto-fill timestamps (см. Фаза 2.3).
- Карточка сделки: история стадий, платежи (`expected` / `confirmed` фильтр), связанные инициативы.

### 8.2. Заблокированные сделки

JOIN `planning_initiatives` (`status != 'done'` AND `type='client_blocker'`) × `planning_initiative_deal_link` × `planning_deals.stage IN ('lead','pilot')`. Показ: «Сделка X (этап Y) ждёт инициативы [...] — потенциал Z ₽/мес».

### 8.3. Чек-лист

- [ ] Создание сделки.
- [ ] Смена этапа → auto-fill timestamps (проверить через SQL).
- [ ] Платежи отображаются. Recurring создаются cron'ом (проверить через `cron.job_run_details`).
- [ ] Страница заблокированных сделок работает.
- [ ] Коммит: `feat(planning): deals, payments and blocked deals view`.

---

## Фаза 9. Сводка (Bento grid)

**Цель**: `/planning/digest` с 10 блоками (§12.6 концепта).

**Файлы**:
- `src/app/planning/digest/page.tsx`.
- `src/components/planning/digest/AlertTier.tsx`.
- `src/components/planning/digest/{YearMetricsBlock, QuarterMetricsBlock, DoneBlock, AtRiskBlock, EarlyWarningBlock, KillCriteriaBlock, StrategySupportBlock, ChangeLogBlock, SalesProgressBlock, SalesTasksBlock}.tsx`.

### 9.1. Layout

Bento CSS Grid с named areas, 5-секундная читаемость (§20.2.5).

### 9.2. Suspense

Каждый блок — `<Suspense>` со skeleton fallback. Параллельные fetch через server components.

### 9.3. Чек-лист

- [ ] Все блоки рендерятся (empty state ok).
- [ ] Alert tier сверху.
- [ ] Параллельная загрузка (skeleton отдельно у каждого).
- [ ] Коммит: `feat(planning): digest page with bento grid`.

---

## Фаза 10. Журнал изменений + квартальная ретроспектива

**Цель**: `/planning/changelog`, `/planning/retrospective/[period_id]`.

**Файлы**:
- `src/app/planning/changelog/page.tsx`.
- `src/app/planning/retrospective/[period_id]/page.tsx`.
- `src/components/planning/ChangelogList.tsx`, `QuarterRetrospective.tsx`.

### 10.1. Журнал

- Infinite scroll по 100.
- Фильтры: entity_type, actor_email, период.
- Компактная строка: timestamp, actor, action, diff (raw JSON в expand).

### 10.2. Квартальная ретроспектива

- 4 поля (общие с месячной).
- Топ replan_reason (count + linked changes).
- Список kill_criteria_triggered за квартал.
- Эксперименты с result + decision.
- Возникшие метрики (`is_emergent = true`).
- Проверка ключевых допущений закрытых инициатив.

### 10.3. Чек-лист

- [ ] Журнал — pagination, фильтры.
- [ ] Квартальная ретроспектива — все блоки.
- [ ] Коммит: `feat(planning): changelog and quarter retrospective`.

---

## Фаза 11. Производительность + Settings + навигация + smoke test

### 11.1. Установка остаточных зависимостей

```bash
npm install framer-motion react-window
```

(`sonner`, `recharts`, `react-hook-form`, `@hookform/resolvers`, `zod` — поставлены в Фазе 3; `wx-react-gantt` — в Фазе 7.)

### 11.2. Производительность

- `react-window` для бэклога задач (если >100).
- `React.memo` на MetricChart, InitiativeCard, TaskCard.
- `useMemo` на data props Recharts.
- Server components для read-only страниц (changelog list).
- `next/dynamic` для Gantt (уже в Фазе 7).
- Realtime: подписки `planning_*` через `src/lib/realtime.ts` только на активном экране, unsubscribe при unmount.

### 11.3. Settings

`src/app/planning/settings/page.tsx`:
- `pilot_default_duration_days`, `early_warning_weeks`, `strategy_support_ratio`, `minor_adjustment_threshold`, `daily_capacity_hours`, `weekly_capacity_hours`, `accent_color`.
- Управление словарями: `planning_icp_segments` (CRUD), `planning_kaiten_board_mapping` (CRUD), `planning_metric_units` (view-only seed + добавление пользовательских).

### 11.4. Навигация

- Добавить ссылку «Планирование» в основной desktop sidebar (по требованию — только desktop, не `/m/`).

### 11.5. Smoke test (концепт §14, сценарий «Выручка 20M ₽»)

1. Создать Direction «Робот Мия», `year_focus`.
2. Создать метрику «Выручка 2026», тип Бизнес, target 20M.
3. Auto-distribute S-кривой.
4. Создать инициативу «Email-канал MVP», тип Блокер, link to «Выручка», `due_period_id = W26`.
5. Создать сделку, перевести в Пилот → проверить `pilot_started_at`, `pilot_planned_end_at` авто-fill.
6. Внести платёж со `status='confirmed'` → метрика обновляется в графике.
7. Открыть «Эта неделя» → drag задачи в день.
8. Открыть Roadmap → видна полоса инициативы.
9. Открыть Сводку → блоки рендерятся.
10. Заполнить ретроспективу периода → pre-fill работает.

### 11.6. Чек-лист

- [ ] Все страницы открываются без 500.
- [ ] Smoke test пройден.
- [ ] `npm run build` зелёный.
- [ ] `npm run lint` без warnings.
- [ ] Settings работает.
- [ ] Навигация в основном меню есть.
- [ ] Коммит: `feat(planning): performance, settings, navigation, smoke test`.

---

## Что делать ПОСЛЕ всех фаз

1. Применить миграции (`0024`, `0025`) на прод (если ещё нет): `npx supabase db push` или Dashboard.
2. Vercel задеплоит автоматически после push в master.
3. Сообщить пользователю что готово, дать ссылки на основные экраны.

---

## Если что-то идёт не так

- **Билд падает на типах** — расширь `src/types/planning.ts` или поправь SQL.
- **API возвращает 500** — проверь `withAuth`, RLS (`is_allowed_user()`).
- **Cron не запускается** — `pg_cron` extension включён, `vault.decrypted_secrets` содержит `app_url` и `cron_secret`.
- **Optimistic UI ломается** — проверь rollback в Zustand.
- **SVAR Gantt не рендерится** — `next/dynamic` + `ssr:false`.
- **Удаление weekly сломало `/m/tasks/` или `src/app/page.tsx`** — `grep -r "weekly_plan\|WeeklyView\|WeeklyTriage"` и снести оставшиеся импорты.

При любой большой проблеме — **остановись и спроси пользователя**.

---

## Финальное напутствие

Этот план — большой. Не пытайся сделать всё за одну сессию.

После каждой фазы:
1. Коммит.
2. Прогон чек-листа.
3. Если близишься к лимиту контекста — обнови `HANDOFF.md`, скажи пользователю «Фаза N завершена, давай новую сессию для фазы N+1».

Удачи.
