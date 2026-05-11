# Plan: Planning System Rework (post-E2E feedback)

> Создан после полного self-hosted E2E-теста + 18 пунктов фидбэка пользователя.
> Опирается на `planning_system_concept.md` (V3 Released).
> Текущий рабочий коммит-чекпоинт: `5ede756`.

---

## 0. Соглашения и отступления от концепта

Решения, согласованные с пользователем, которые отличаются от того, что написано в `planning_system_concept.md`:

| Что | Концепт (V3 Released) | Решение |
|---|---|---|
| Task ↔ Initiative | 1:N через `items.initiative_id` (§3.6) | **M:N** через новую таблицу `planning_item_initiative_link`; `items.initiative_id` остаётся для совместимости как «primary», но UI читает из join-таблицы |
| Подзадачи | §3.6 не оговаривает | Подзадачи **не привязываются напрямую** к инициативе. Появляются в списке инициативы автоматически если parent привязан |
| Дедлайн инициативы | `due_period_id` (одна неделя, §3.4.1) | **Диапазон**: `start_period_id` + `end_period_id`. Последняя дата = дедлайн. Сдвиг диапазона = перепланирование с причиной |
| Тип «Зрелость продукта» | `product_maturity` (§3.4) | UI-лейбл «Развитие продукта». Enum-значение `product_maturity` сохраняем для совместимости с данными |
| Зависимости инициатив | §3.5 + §3.4.1 (`parent_initiative_id` отдельно) | UI **убираем**. Таблица `planning_initiative_dependency` остаётся пустой (drop позже) |
| Источник факта метрики | `kaiten / grafana / second_brain / product_analytics / manual` (§3.3) | Убираем `kaiten`. Остаются `manual`, `second_brain`. `grafana` и `product_analytics` пока не реализуем (но enum-значения не дропаем) |
| Инициализация года | Авто при первом создании метрики/инициативы (§3.10) | UI-кнопка убирается. Server-side: `seed_planning_periods(year)` + cron daily ensuring current+next year |
| Distribute по горизонтам | Раздельные кривые на каждый горизонт | **Только по неделям**. Месяц/квартал = SUM соответствующих недель (агрегированный view) |
| RICE-лейблы | Русские (§3.4.3) | UI на английском: `Reach / Impact / Confidence / Effort / Score` (по запросу пользователя) |

---

## 1. Фазы

Каждая фаза — отдельный коммит (или набор коммитов с логической границей).

### P0 — Фундамент (schema + cleanup) — **этой сессией**

- [ ] `0027_planning_item_initiative_link.sql`: M:N items↔initiatives, backfill из `items.initiative_id`
- [ ] `0028_initiative_week_range.sql`: `start_period_id`, `end_period_id` на `planning_initiatives`. Backfill: оба = `due_period_id`. Triggered: drop NOT NULL c due_period_id
- [ ] `0029_seed_periods.sql`: SQL функция `ensure_planning_year(p_year int)`; вызывается из триггера на INSERT `planning_metrics`/`planning_initiatives`; cron daily для current+next year
- [ ] `0030_planning_metric_source_constraint.sql`: убрать `'kaiten'` из CHECK enum source у metric
- [ ] Удалить UI «Инициализировать год» и эмпти-стейт периодов
- [ ] Удалить `kaiten` из option-list в форме метрики
- [ ] Удалить UI-секцию «Зависимости» в `InitiativeDetailSheet`
- [ ] Rename type-label `product_maturity` → «Развитие продукта» в `INITIATIVE_TYPE_LABEL` map (UI only)

### P1 — Рабочий поток инициативы — ✅ закрыта

- [x] `CreateInitiativeWizard`: 4-шаговая модалка (тип → базовые → JTBD/Гипотеза → связи). Для tech_debt/support — третий шаг пропускается. Запись через POST с `start_period_id`/`end_period_id`.
- [x] JTBD-подсказка per type в `src/lib/planning-initiative-meta.ts` (description/example/placeholder). Inline-hint под селектом типа в DetailSheet; пример в JTBD-секции.
- [x] Replanning fix: `isReplanEndPeriod` = `"end_period_id" in updates && data.end_period_id !== null && updates.end_period_id !== data.end_period_id`. Первое задание дедлайна и смена статуса диалог не открывают.
- [x] RICE: EN лейблы (Reach / Impact / Confidence / Effort / Score; chips — Minimal..Massive, Low/Medium/High). **Найден и исправлен баг**: postgres.js возвращает `numeric` строкой, поэтому `impact === opt.value` (number) был всегда false → кнопки не залипали. Везде в `RicePicker` добавлен `Number(...)` cast.
- [x] DealLinksEditor (для client_blocker): add/remove + per-deal `blocks_stage` (pilot/production). Новый API `POST/DELETE /api/planning/initiatives/[id]/deal-links`.
- [x] «Зависимости» уже убраны в P0.
- [x] Кнопка «Убить» переименована в «Закрыть без реализации», `Skull` → `XCircle`, tooltip объясняет смысл `killed`-статуса.

### P2 — Колонка инициатив — ✅ закрыта

- [x] Period cascade-фильтр `PeriodCascadeFilter`: Q → M → W. Дефолт — текущая неделя (через `findCurrentPeriod` при первом `fetchAll`). Логика «пересечения» — в [src/lib/planning-period-utils.ts](src/lib/planning-period-utils.ts) (`initiativeIntersectsPeriod`).
- [x] Badge «Просрочена» (красный фон карточки + явный inline-бейдж) для инициатив где `end_period.end_date < now()` и `status != done/killed`. `initiativeDeadlineTone` теперь читает `end_period_id` с fallback на `due_period_id`.
- [x] `WeekGridPicker` — компактный grid 4 quarter × 13 week, подсветка текущей недели (amber ring) и диапазона (синяя заливка). Подключён в `InitiativeDetailSheet` (на замену пары `<select>`) и в `CreateInitiativeWizard` Step 2.

### P3 — Колонка задач — ✅ закрыта

- [x] `0030_sync_item_initiative_link.sql` — trigger items.initiative_id ↔ M:N. Источник правды для UI — M:N, legacy-колонка зеркалится автоматически (для autoLinkOrphanTaskToSupport, /api/items PUT, Kaiten sync).
- [x] db helpers: `linkItemToInitiative` / `unlinkItemFromInitiative` / `listInitiativeItems` (с подзадачами parent'а автоматически).
- [x] API `/api/planning/initiatives/[id]/items` — GET (список с подзадачами) / POST (bulk attach) / DELETE (?item_id=).
- [x] `TaskColumn` переписан: «создание с нуля» убрано → кнопка «Привязать» открывает picker; колонки `title/why · status · est`; фильтры (all/open/done), сортировка (по статусу/новые/по оценке), группировка (нет/статус/категория); подзадачи показываются вложенно под parent.
- [x] `TaskDetailDrawer` — клик по строке открывает drawer: title (inline), status, category, why, estimate, planned_date, **multi-select «Привязана к инициативам»** (M:N picker).
- [x] `TaskLinkPicker` — модалка с поиском по title/why + чекбоксы для bulk-привязки.
- [x] Store: `initiativeItemIds[ini]` индекс + `fetchInitiativeItems` / `linkItemsToInitiative` / `unlinkItemFromInitiative` с optimistic UI.

### P4 — Метрика (источник факта и редактирование) — ✅ закрыта

- [x] **Migration 0031 `metric_targets_weekly_only`** применена. Колонка `planning_metrics.annual_target` добавлена (годовая цель — input, не target-row). Не-week target-row удалены. Триггер `planning_metric_targets_week_only_trg` блокирует записи в quarter/month/year.
- [x] **API targets — агрегация на лету**: `GET /api/planning/metrics/[id]/targets?period_type=quarter|month|week&year=YYYY`. Quarter/Month — SUM weeks внутри диапазона. Helper `listMetricTargetsForPeriodType` в `src/lib/db.ts`.
- [x] **API targets PATCH — pro-rate**: при PATCH non-week period_id значение разносится пропорционально на week-children (`patchAggregatedTarget`). Edit квартала ⇒ автоматически разнесёт на его 13 недель.
- [x] **API distribute — всегда weeks**: server-side всегда раскладывает на 52 недели независимо от `period_type` в body. Поддержка `skip_weeks_before` (ISO date) — пропустить ранние недели (для «Перераспределить недобор»).
- [x] **MetricActualsTable**: 4-колоночная таблица «Период / План / Факт / Δ». Колонка «Факт» editable для `source='manual'`. Для cumulative — SUM ticks периода; для non-cumulative — LAST tick. Заменила `MetricTargetsTable` в drawer'е и на странице метрики.
- [x] **API `/api/planning/metrics/[id]/actuals` PATCH** — items=[{period_id, value}]. Удаляет существующие ticks в диапазоне периода и вставляет один tick с `measured_at=end_date`, `source='manual'`.
- [x] **Variance indicator на MetricCard**: `±Δ vs план YTD` под цифрой факта, цвет зависит от `direction_value` (up: green=positive, down: green=negative).
- [x] **API `/api/planning/metrics/[id]/ytd`** — возвращает `{annual_target, target_ytd, actual_ytd, variance}`. Загружается в store `metricYtd` параллельно со sparklines.
- [x] **«Перераспределить недобор»**: кнопка в drawer'е рядом с «Распределить». Открывает тот же AutoDistributeDialog, но с `skipWeeksBefore=today` и `initialYearTarget=annual − actual_ytd`. Никакого автомата — explicit user action.

### P5 — Сделки (entity + revenue) — ✅ закрыта

- [x] **CRUD API сделок** + страница `/planning/deals` уже были реализованы ранее (commit `658ba50`).
- [x] **Auto-fill stage timestamps** (concept §6.7.5) уже работает в `/api/planning/deals/[id] PATCH`: при переходе в `pilot` ставится `pilot_started_at`+`pilot_planned_end_at` (default 60 дней или из `pilot_default_duration_days`); при `production` — `production_started_at`.
- [x] **Auto-recurring payments cron** (concept §6.7.2) уже работает: `/api/cron/planning/recurring-payments` через pg_cron daily 03:00 UTC создаёт ежемесячный `expected` платёж для каждого `stage='production'` deal с `min_monthly_amount>0`. Идемпотентно — пропускает существующие.
- [x] **UI редактирования платежей**: inline-edit amount, toggle статус `expected ↔ confirmed` одним кликом, удаление платежа (с подтверждением). См. `src/app/planning/deals/[id]/page.tsx`.
- [x] **Revenue aggregator (`source='second_brain'`)**:
  - `listEffectiveMetricTicks(metric, range)` в `src/lib/db.ts` — для business + `source='second_brain'` возвращает синтезированные ticks из `planning_deal_payments` (включая `expected` + `confirmed`).
  - `GET /api/planning/metrics/[id]/ticks` использует helper — sparkline на карточке метрики «Выручка» автоматически рисуется по фактам платежей.
  - `GET /api/planning/metrics/[id]/ytd` для business+second_brain считает `actual_ytd = SUM(deal_payments.amount)` за текущий год.
  - `MetricActualsTable` через `/ticks` показывает агрегацию по периодам.
- [x] **Initiative-linked deals**: editor `DealLinksEditor` (P1) добавляет/удаляет связи `initiative_deal_link` с `blocks_stage`. На странице сделки прямой обратной отрисовки нет — но через `/planning/blocked-deals` (commit `658ba50`) видно сделки, которые блокированы.

### P6 — Полишинг и тех-долг — ✅ закрыта

- [x] **planning_initiative_dependency**: API возвращает `410 Gone`; DB helpers (`addDependency` / `removeDependency` / `listInitiativeDependencies`) сделаны no-op; cascade-логика в `early-warning` cron удалена; таблица убрана из `supabase_realtime` publication. Сам `DROP TABLE` отложен миграцией 0032 — таймаутится из-за lock contention; выполнить вручную позже (комментарий в SQL-файле).
- [x] **weekly-plans API + src/components/weekly/***: уже удалены в предыдущих коммитах (§17 концепта).
- [x] **Empty states**: уже расставлены в P0..P3 (`InitiativeColumn`, `TaskColumn`, `MetricColumn`, `MetricDetailSheet`); явных «пустых пустот» без CTA в основных flow нет.

### P7 — Недостающие детали из исходного фидбэка — **этой сессией**

Аудит показал, что часть пунктов исходных 18-ти осталась нереализованной/частично реализованной. Каждый gap зафиксирован с конкретной ссылкой на код, чтобы не повторилось «помечено как done, а в коде нет».

#### P7.1 EN-заголовки во всём drawer'е инициативы (фидбэк #10) — `НЕ РЕАЛИЗОВАНО`

Пользователь сказал: «RICE делаем по английски, **все заголовки внутри инициативы**». Реализовано только для RICE/JTBD/Kill criteria. Русские остались:
- «Тип» ([InitiativeDetailSheet.tsx:221](src/components/planning/InitiativeDetailSheet.tsx#L221)) → `Type`
- «Статус» (L238) → `Status`
- «Оценка (ч)» (L259) → `Estimate (h)`
- «Диапазон недель» (L277) → `Week range`
- «Описание» (L300) → `Description`
- «Ключевые допущения» (L469) → `Key assumptions`
- «Связанные метрики» (L378) → `Linked metrics`
- «Связанные сделки» (L402) → `Linked deals`
- «Заблокированные сделки» (L583) → `Blocked deals`

Кнопки/тосты остаются на русском (это UX-текст, не заголовки).

#### P7.2 Quick-buttons для дедлайна (фидбэк #7) — `НЕ РЕАЛИЗОВАНО`

«Перенесём поле с оценкой на отдельную строчку и **добавим сразу же предзаготовленные кнопки рядом с вводом кастомным**». В контексте дедлайна — это быстрые offset-кнопки. План:
- Над/рядом с `WeekGridPicker` добавить ряд chip-кнопок: «+1 нед / +2 нед / +1 мес / +3 мес / +6 мес» (относительно `start_period_id` если задан, иначе текущей недели).
- Клик — сразу выставляет `end_period_id` на соответствующую неделю; grid-picker остаётся для произвольного выбора.
- Если `end_period_id` уже был задан и новый клик его меняет → срабатывает существующий `ReplanReasonDialog` (логика P1).

#### P7.3 Quick-buttons для оценки (фидбэк #7) — `ЧАСТИЧНО`

Поле `estimate_hours` уже отдельной строчкой ([InitiativeDetailSheet.tsx:259-271](src/components/planning/InitiativeDetailSheet.tsx#L259)), но без presets. Добавить chip-кнопки рядом с input: `4ч / 8ч / 16ч / 40ч / 80ч` (полдня / день / 2 дня / неделя / 2 недели). Клик — заполняет input + PATCH.

#### P7.4 At-risk учитывает прогресс задач (фидбэк #15) — `ЧАСТИЧНО`

Пользователь: «Если дедлайн достигнут, но **связанные с ней задачи не выполнены**, значит инициатива просрочена / потерпела неудачу. Требуется в таком случае подсвечивать.» Сейчас `initiativeDeadlineTone` ([src/lib/planning-colors.ts:62-82](src/lib/planning-colors.ts#L62)) смотрит только на дату + статус.

План:
- В `initiativeDeadlineTone` добавить параметр `progress: { done: number; total: number } | undefined`.
- Если `endTs < now AND status NOT IN (done, killed) AND (total === 0 OR done/total < 0.8)` → новый тон `failed` (более яркий красный, badge «Потерпела неудачу»).
- Если `at_risk` (в окне `early_warning_weeks`) AND `done/total < 0.5` → усиленный амбер с badge «Отстаёт».
- `InitiativeCard` получает прогресс из store (`initiativeItemIds[ini]` + статусы items уже есть из P3) и пробрасывает.
- Cron `early-warning` уже умеет считать `done_count / total < 0.8` — переиспользовать порог для consistency.

#### P7.5 TaskColumn — расширенный фильтр как в Tasks (фидбэк #16) — `ЧАСТИЧНО`

Сейчас: `status (all/open/done)`, `sort (created/status/estimate)`, `group (none/status/category)` ([TaskColumn.tsx:53-55](src/components/planning/TaskColumn.tsx#L53)). Пользователь хотел «аналогично разделу Задачи расширенным фильтром».

План (без полного `AdvancedFilterBuilder` — это overkill для drawer'а; компактный pragmatic-вариант):
- **Text search** по `title` + `why` (debounced 200ms).
- **Multi-select category** (читаем `useStore.categories`).
- Сортировка дополнительно: `due_date asc/desc`.
- Группировка дополнительно: `priority`.
- Сохранение состояния фильтра в `localStorage` (per-initiative ключ необязательно — глобально).

#### P7.6 TaskColumn — управление колонками (фидбэк #16) — `НЕ РЕАЛИЗОВАНО`

Пользователь хотел: «скрывать те или иные колонки можно, или менять их местами». План:
- Над таблицей — иконка-кнопка `Columns ▾` открывающая popover с checkbox-списком колонок: `Title/Why`, `Status`, `Category`, `Est`, `Due`.
- Внутри popover — drag-handle для reorder (используем `dnd-kit` который уже в стеке).
- State хранится в `localStorage` ключом `planning.taskColumn.cols` (`{visible: string[], order: string[]}`).
- Дефолт: показаны `Title/Why`, `Status`, `Est` (как сейчас) в том же порядке — текущие пользователи не заметят изменения.

---

## 5. Открытые вопросы для P7

- Естимат `40ч`/`80ч` (неделя/2 недели) — нужны ли preset'ы такого размера, или ограничиться `4/8/16ч`? **Решение по умолчанию**: оставлю `4 / 8 / 16 / 40` — закрывает большинство кейсов.
- При at-risk порог `done/total < 0.8` — согласован с cron'ом `early-warning`. Если хочется строже (например `< 0.95`) — менять одну константу.

---

# P8 — Перенос сделок в раздел «Клиенты»

> Запрос пользователя: «Сделки» как отдельная сущность не нужны — всё переезжает внутрь клиентов. Один клиент может иметь несколько сделок. Стадии берутся из существующих `client_statuses`. Виртуальная выручка считается с даты старта пилота. Авто-переход «Пилот → Договор» по дате окончания пилота.

## §0. Текущее состояние (факты после аудита)

| Что | Где | Кратко |
|---|---|---|
| `clients` | [0001_initial.sql:155](supabase/migrations/0001_initial.sql#L155) | id (text), name, status_id (FK), budget, operators_*, calls_per_month, crm_system, position, timestamps |
| `client_statuses` | [0001_initial.sql:148](supabase/migrations/0001_initial.sql#L148) | id, name, color, position. **Не seed — создавал пользователь.** |
| Реальные статусы в проде | прод-БД | `Не в работе / В работе / Встреча назначена / Демо проведено / Внутреннее тестирование / Пилот / Договор / Не подошел / Мы не подошли` |
| `planning_deals` | [0023_planning_system.sql:163](supabase/migrations/0023_planning_system.sql#L163) | stage enum, pilot_*/production_* timestamps, min_monthly_amount, expected_actual_amount, client_id |
| `planning_deal_payments` | [0023_planning_system.sql:188](supabase/migrations/0023_planning_system.sql#L188) | deal_id FK, paid_at, amount, status (expected/confirmed), note |
| `planning_initiative_deal_link` | [0023_planning_system.sql:204](supabase/migrations/0023_planning_system.sql#L204) | initiative_id, deal_id, blocks_stage (pilot/production) |
| UI клиентов | [src/components/clients/*](src/components/clients) | `ClientsView`, `ClientsKanban`, `ClientDetailModal`, `CreateClientDialog`, `StatusManager` — отдельной страницы `/clients` нет, рендерится из корня |
| UI сделок | [src/app/planning/deals/](src/app/planning/deals) | list + detail; recurring/stage-fill уже работает |
| Blocked deals | [src/app/planning/blocked-deals/page.tsx](src/app/planning/blocked-deals/page.tsx) | список сделок с активной связью к незакрытой инициативе |
| Revenue aggregator | [src/lib/db.ts:2148](src/lib/db.ts#L2148) `listEffectiveMetricTicks` + [api/planning/metrics/[id]/ytd/route.ts:42](src/app/api/planning/metrics/[id]/ytd/route.ts#L42) | читает `planning_deal_payments` для `business + second_brain` |
| Cron recurring | [api/cron/planning/recurring-payments/route.ts](src/app/api/cron/planning/recurring-payments/route.ts) | каждый месяц создаёт `expected`-платёж для `stage='production' AND min_monthly_amount>0` |

`client_revenue_entries` была удалена вместе с goals (commit `d0a808c`, миграция 0022) — её не возрождаем, делаем чистый `client_deal_payments`.

---

## §1. Терминология P8

- **Сделка** — запись в новой таблице `client_deals`. У одного клиента может быть N сделок (например, два пилота параллельно по разным внедрениям + один прод). Сделка имеет свой `title`, свою стадию, свои даты пилота/прода, свою «минимальную месячную сумму».
- **Стадия сделки** определяется через **`status_id` сделки** (FK на тот же `client_statuses`, что и у клиента). Логика «является ли это пилотом / продом / churn» — через мэппинг (см. §2).
- **Стадия клиента** агрегируется: «самая прогрессивная стадия среди его активных сделок» (или ручной override). На MVP — отдельной агрегации не делаем, статус клиента остаётся ручным; влияет только на список.
- **Виртуальная выручка** — план-факт ежемесячного платежа, ожидаемого с момента старта пилота (не прода!). Если фактический платёж пришёл — пользователь правит amount/status, и тогда это уже «фактическая выручка». На MVP в метрику «Выручка» этот тип не включаем (см. §6) — только инфраструктура.

---

## §2. Меппинг lifecycle на `client_statuses`

**Вопрос пользователю**: какие из существующих статусов соответствуют ключевым стадиям lifecycle? Ниже мой proposal — подтверди или скорректируй:

| Lifecycle stage | Существующий status | Логика |
|---|---|---|
| `pilot` | **«Пилот»** (`f2a906f9-…`) | Включает таймер pilot_planned_end_at, начисляет виртуальные платежи |
| `production` | **«Договор»** (`4a2c7d31-…`) | Прод-стадия; платежи становятся фактическими |
| `churned` | **«Не подошел»** + **«Мы не подошли»** (`db3f40b0-…`, `112c7275-…`) | Останавливает recurring-генерацию платежей |
| `lead/early` (всё остальное) | Не в работе / В работе / Встреча / Демо / Внутр.тест | Без особой логики, до пилота |

**Хранение мэппинга:** добавляю в `planning_settings` (или новой таблицей `client_lifecycle_mapping`) поля:
- `pilot_status_id text NOT NULL` (default — id «Пилот»)
- `production_status_id text NOT NULL` (default — id «Договор»)
- `churned_status_ids text[] NOT NULL` (default — `["Не подошел", "Мы не подошли"]` IDs)

Это позволяет переопределить, если статусы переименуют.

---

## §3. Миграции схемы (атомарным коммитом)

### `0033_client_deals.sql` — новая таблица сделок на клиенте

```sql
CREATE TABLE public.client_deals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id text NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  title text NOT NULL DEFAULT '',
  status_id text REFERENCES client_statuses(id) ON DELETE SET NULL,
  -- pilot/prod таймстемпы (как было на planning_deals, но на клиентской сделке)
  pilot_started_at timestamptz,
  pilot_default_duration_days int NOT NULL DEFAULT 60,
  pilot_planned_end_at timestamptz,
  pilot_ended_at timestamptz,
  production_started_at timestamptz,
  -- финансы
  min_monthly_amount numeric,
  expected_actual_amount numeric,
  description text,
  status_changed_at timestamptz,
  position int NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
CREATE INDEX idx_client_deals_client ON client_deals(client_id);
CREATE INDEX idx_client_deals_status ON client_deals(status_id);
-- RLS + realtime publication.
```

### `0034_client_deal_payments.sql` — платежи на сделке

```sql
CREATE TABLE public.client_deal_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id uuid NOT NULL REFERENCES client_deals(id) ON DELETE CASCADE,
  paid_at date NOT NULL,
  amount numeric NOT NULL,
  note text,
  status text NOT NULL DEFAULT 'expected' CHECK (status IN ('expected','confirmed')),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
CREATE INDEX idx_client_deal_payments_deal_paid ON client_deal_payments(deal_id, paid_at);
CREATE INDEX idx_client_deal_payments_paid ON client_deal_payments(paid_at);
-- RLS + realtime publication.
```

### `0035_initiative_client_blocking.sql` — связь инициатива → клиент

```sql
CREATE TABLE public.planning_initiative_client_block (
  initiative_id uuid NOT NULL REFERENCES planning_initiatives(id) ON DELETE CASCADE,
  client_id text NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  -- На какой именно сделке клиента (опционально — если null, блокирует все pilot/prod сделки)
  deal_id uuid REFERENCES client_deals(id) ON DELETE CASCADE,
  blocks_stage text CHECK (blocks_stage IN ('pilot','production')),
  PRIMARY KEY (initiative_id, client_id, COALESCE(deal_id::text, ''))
);
-- RLS + realtime publication.
```

**Заметка:** оригинально я думал переименовать `planning_initiative_deal_link`, но раз `planning_deals` дропается, проще сделать новую таблицу — старая идёт в `0036_drop_legacy_planning_deals.sql`.

### `0036_extend_planning_settings.sql` — мэппинг lifecycle

```sql
ALTER TABLE public.planning_settings
  ADD COLUMN pilot_status_id text REFERENCES client_statuses(id),
  ADD COLUMN production_status_id text REFERENCES client_statuses(id),
  ADD COLUMN churned_status_ids text[] DEFAULT '{}';

-- Pre-fill по name (если статусы есть). Идемпотентно — UPDATE … FROM client_statuses.
UPDATE planning_settings SET
  pilot_status_id = (SELECT id FROM client_statuses WHERE name = 'Пилот' LIMIT 1),
  production_status_id = (SELECT id FROM client_statuses WHERE name = 'Договор' LIMIT 1),
  churned_status_ids = ARRAY(SELECT id FROM client_statuses WHERE name IN ('Не подошел','Мы не подошли'));
```

### `0037_drop_legacy_planning_deals.sql` — финал

```sql
DROP TABLE IF EXISTS public.planning_initiative_deal_link CASCADE;
DROP TABLE IF EXISTS public.planning_deal_payments CASCADE;
DROP TABLE IF EXISTS public.planning_deals CASCADE;
-- ALTER PUBLICATION supabase_realtime DROP TABLE … (если не удалится автоматически)
```

**Триггеры:**
- `client_deals_status_change_trg` — если `status_id` сменился на `pilot_status_id`, проставляем `pilot_started_at = now()` (если null), `pilot_planned_end_at = pilot_started_at + pilot_default_duration_days days` (если null), `status_changed_at = now()`.
- При смене на `production_status_id`: `production_started_at = now()` (если null), `pilot_ended_at = now()` (если null AND был пилот).
- При смене на churned: ничего особого, просто `status_changed_at`.

---

## §4. DB layer ([src/lib/db.ts](src/lib/db.ts))

Удаляем (или маркируем `@deprecated`):
- `listPlanningDeals`, `getPlanningDeal`, `createPlanningDeal`, `updatePlanningDeal`, `deletePlanningDeal`
- `listDealPayments`, `addDealPayment`, `updateDealPayment`, `deleteDealPayment`
- `listInitiativeDealLinks`, `linkInitiativeToDeal`, `unlinkInitiativeFromDeal`
- `listBlockedDeals`

Добавляем:
- `listClientDeals(filter?: { client_id?, status_id?, lifecycleStage?: 'pilot'|'production'|'churned' })`
- `getClientDeal(id)` / `createClientDeal(input)` / `updateClientDeal(id, updates)` / `deleteClientDeal(id)`
- `listClientDealPayments(filter)` / `addClientDealPayment` / `updateClientDealPayment` / `deleteClientDealPayment`
- `listInitiativeClientBlocks(initiative_id)` / `linkInitiativeToClient(initiative_id, client_id, deal_id?, blocks_stage?)` / `unlinkInitiativeFromClient(...)`
- `listBlockedClients()` — клиенты с активной связью к незакрытой инициативе (для нового UI)
- `listEffectiveMetricTicks` — переписать с `planning_deal_payments` на `client_deal_payments`
- В `getPlanningSettings` — вернуть новые поля мэппинга.

Stage detection helper: `getClientDealLifecycleStage(deal, settings)` → `'pilot'|'production'|'churned'|'pre_pilot'|null`.

---

## §5. API endpoints

### Удаляются (вернут 410 Gone для grace period 1 release, потом DROP):
- `/api/planning/deals` GET/POST
- `/api/planning/deals/[id]` GET/PATCH/DELETE
- `/api/planning/deals/[id]/payments` все методы
- `/api/planning/blocked-deals` GET
- `/api/planning/initiatives/[id]/deal-links` POST/DELETE

### Добавляются:
- `/api/clients/[id]/deals` GET (список сделок клиента) / POST (создать новую сделку)
- `/api/clients/[id]/deals/[deal_id]` GET / PATCH / DELETE
- `/api/clients/[id]/deals/[deal_id]/payments` GET / POST / PATCH / DELETE
- `/api/planning/blocked-clients` GET — список заблокированных клиентов
- `/api/planning/initiatives/[id]/client-blocks` POST / DELETE — связи инициатив с клиентами/сделками

### Изменяются (схема payload):
- `/api/planning/metrics/[id]/ticks` — на бэкенде агрегирует `client_deal_payments` (видно через `listEffectiveMetricTicks`)
- `/api/planning/metrics/[id]/ytd` — то же, agg из `client_deal_payments`
- `/api/planning/settings` PATCH — добавляются поля `pilot_status_id`, `production_status_id`, `churned_status_ids`

---

## §6. UI — карточка клиента (`ClientDetailModal`)

**Текущая модалка** ([src/components/clients/ClientDetailModal.tsx](src/components/clients/ClientDetailModal.tsx)) — добавляем **табы**:

```
┌── Tabs ──────────────────────────────────────┐
│ Основное │ Сделки (3) │ Контакты │ Платежи  │
└──────────────────────────────────────────────┘
```

### Таб «Сделки»

- Список сделок клиента (карточками или строками).
- Колонки: `title`, `status` (chip), `pilot end date / production start`, `MRR`, действия.
- Кнопка `+ Новая сделка` → inline-форма (title, status_id выбор, min_monthly_amount).
- Click на сделку → раскрытие inline (или sub-drawer) с:
  - title (inline-edit)
  - status_id (chips из client_statuses, как на клиенте)
  - pilot_started_at / pilot_planned_end_at / production_started_at — date inputs
  - min_monthly_amount / expected_actual_amount — inline number
  - description — textarea
  - Список платежей (см. ниже)
  - кнопка «Удалить сделку»
- Если status_id меняется на «Пилот» — авто-fill `pilot_started_at = now()` и `pilot_planned_end_at = +60 дней` (по триггеру в БД).
- Если status_id меняется на «Договор» — авто-fill `production_started_at`. Это уже работает в P5 для planning_deals — переносим на client_deals.

### Таб «Платежи»

- Аггрегированный по клиенту список всех платежей (по всем его сделкам).
- Колонки: `paid_at`, `deal.title`, `amount`, `status` (expected/confirmed toggle), action.
- Inline edit amount (как сейчас работает в `/planning/deals/[id]` payments — переносим).
- Кнопка «+ Платёж» с выбором сделки и инлайн-формой amount/paid_at.

### Таб «Основное»

Остаётся как было + новый блок «Lifecycle» который показывает (read-only):
- Текущая стадия (агрегат из сделок: pilot/production/churned/pre-pilot)
- Сводный MRR (`SUM(min_monthly_amount)` по активным сделкам)

---

## §7. UI — список клиентов

В [src/components/clients/ClientsView.tsx](src/components/clients/ClientsView.tsx) (или Kanban) добавляются колонки:

| Колонка | Источник |
|---|---|
| **Stage** | Текущая агрегированная стадия по сделкам |
| **MRR (₽)** | `SUM(min_monthly_amount)` для prod/pilot сделок |
| **Pilot ends** | `MIN(pilot_planned_end_at)` среди active pilot сделок — для индикации «скоро кончится» |

«Скоро кончится пилот» (через `early_warning_weeks` settings) → амбер-чип «Pilot ends in N days» (или красный если уже прошло).

---

## §8. Revenue aggregator

Переписать [src/lib/db.ts:2148](src/lib/db.ts#L2148) `listEffectiveMetricTicks`:

```sql
-- Старое:
SELECT id, amount::text, paid_at, status FROM planning_deal_payments WHERE …
-- Новое:
SELECT p.id, p.amount::text, p.paid_at, p.status, d.client_id, d.title AS deal_title
FROM client_deal_payments p
JOIN client_deals d ON d.id = p.deal_id
WHERE p.paid_at >= ? AND p.paid_at <= ?
ORDER BY p.paid_at DESC
```

YTD endpoint аналогично.

**Важно (по запросу пользователя)**: «виртуальная выручка от пилота» НЕ включается в метрику Выручка пока. Поэтому в SELECT для метрики добавляем фильтр:
```sql
WHERE p.paid_at >= ? AND p.paid_at <= ?
  AND d.production_started_at IS NOT NULL    -- только сделки, которые в прод
  AND p.paid_at >= d.production_started_at   -- платежи только после старта прода
```

Это означает: рекуррентные платежи всё ещё создаются с момента pilot_started (для UI «Виртуальная выручка» в карточке клиента), но **в метрику попадают только те, что после production_started_at**.

Альтернатива (попроще): cron создаёт recurring только с `production_started_at`; рекуррентные с pilot_started — на будущее (под флагом feature.virtual_revenue). На MVP — берём этот простой вариант.

**Финал**: §9 описывает решение по cron'у.

---

## §9. Cron — recurring-payments

[api/cron/planning/recurring-payments/route.ts](src/app/api/cron/planning/recurring-payments/route.ts) переписываем:

- Источник — `client_deals` вместо `planning_deals`.
- Условие генерации: `production_started_at IS NOT NULL AND min_monthly_amount > 0 AND (status_id != ANY(churned_status_ids))`.
- Идемпотентность по `(deal_id, paid_at[year,month])` — как сейчас.
- **Виртуальная выручка не генерируется автоматически на MVP** — это будущая фича. Если нужно прямо сейчас — пишем второй cron `pilot-virtual-revenue` под флагом. Согласовываем в открытых вопросах.

Новый cron **`pilot-overdue-transition`** (или хук в `early-warning`):
- Каждый день: ищет client_deals с `status_id = pilot_status_id AND pilot_planned_end_at < now()`.
- Действия:
  - (a) Push в `notifications_log` (`planning_pilot_overdue` уже есть в CHECK).
  - (b) **Не делает автоматический перевод** на production_status. Пользователь видит уведомление и сам кликает «Перевести в Договор».
  - Альтернатива: автоматический перевод. Пользователь сказал «Автоматический по дате окончания пилота или ручной, если я сам замен статус» — то есть авто. На MVP я бы сделал автоматический + лог в `planning_change_log` с reason='pilot_window_ended'. Открытый вопрос.

---

## §10. Cleanup — удаление /planning/deals

После того как код переехал:
1. Удалить файлы:
   - `src/app/planning/deals/page.tsx`
   - `src/app/planning/deals/[id]/page.tsx`
   - `src/app/planning/blocked-deals/page.tsx`
2. Удалить навигацию из sidebar (если есть пункты «Сделки», «Заблокированные сделки»).
3. Удалить routes:
   - `src/app/api/planning/deals/**`
   - `src/app/api/planning/blocked-deals/route.ts`
   - `src/app/api/planning/initiatives/[id]/deal-links/route.ts`
4. Заменить ссылки в коде: `planning_deal` → `client_deal`, `DealLinksEditor` → `ClientBlocksEditor`.

«Заблокированные сделки» как фича переезжает на новую страницу `/planning/blocked-clients` (или внутрь Сводки).

---

## §11. Initiative ↔ Client UI

В [InitiativeDetailSheet.tsx](src/components/planning/InitiativeDetailSheet.tsx) — секция «Blocked deals» меняется на **«Blocked clients»**:

```
┌── Blocked clients ────────────────────────┐
│ [+ Add]                                    │
│ ┌──────────────────────────────────────┐  │
│ │ ООО Альфа · pilot (Сделка №2)        │  │
│ │ blocks_stage: [pilot ▾] [×]          │  │
│ └──────────────────────────────────────┘  │
└────────────────────────────────────────────┘
```

- Picker открывает выбор: сперва клиент, потом (опционально) конкретную сделку клиента (либо «все pilot/prod сделки этого клиента»).
- API — `/api/planning/initiatives/[id]/client-blocks` (см. §5).
- RICE reach считается `linked_clients.length + connected_deals.length` (как и сейчас, только источник другой).

---

## §12. Атомарность коммита

Всё P8 — **один коммит** (по правилу CLAUDE.md про атомарность миграций):

1. Миграции 0033..0037 — применить через `mcp__execute_sql` / `apply_migration`.
2. Все DB-хелперы — в одном patch на `src/lib/db.ts`.
3. Все API-роуты — добавить новые, старые превратить в 410 Gone (или удалить совсем — раз продовых данных нет, можно сразу).
4. UI: `ClientDetailModal` с табами, обновлённый `ClientsView`, `BlockedClientsPage`, `ClientBlocksEditor` в InitiativeDetailSheet.
5. Cron `recurring-payments` переписан на client_deals; добавлен `pilot-overdue-transition` (если решим делать авто-переход — см. §9).
6. Удаление `/planning/deals` и `/planning/blocked-deals` страниц и API.
7. Коммит-сообщение: `feat(planning): P8 — переезд сделок в раздел Клиенты + виртуальная выручка инфраструктура`.

После пуша — мониторим Vercel deploy. TypeScript-чек скорее всего поймает 5-10 мест где остался `planning_deals`/`DealLinksEditor` — фиксим итеративно.

---

## 6. Открытые вопросы P8 (нужны ответы перед стартом кода)

1. **Меппинг статусов** (§2): подтверди мой proposal (`Пилот` / `Договор` / `Не подошел`+`Мы не подошли`) или скажи свой.

2. **Pilot-overdue auto-transition** (§9): когда `pilot_planned_end_at < now()`, делаем
   - (a) Авто-перевод status_id → «Договор» (плюс лог в change_log с reason)
   - (b) Только уведомление, пользователь сам кликает
   - (c) Авто-перевод **только** если за время пилота было хоть одно `confirmed`-платёж; иначе только уведомление

3. **Recurring-virtual-payments** (§9): cron generates expected-платежи
   - (a) С момента **production_started_at** (как сейчас) — только реальные
   - (b) С момента **pilot_started_at** — включая «виртуальные» (но они НЕ войдут в метрику Выручка, см. §8)
   - Пользователь сказал «давай сделаем с даты старта пилота» → выбор (b). Но «виртуальную выручку в метрики пока не делаем». Значит rec.gen с pilot, метрика читает только after production. **Подтверди или коррекция.**

4. **Default pilot_default_duration_days**: 60 дней (как сейчас) или другое? Хранится глобально в `planning_settings.pilot_default_duration_days` (уже есть в P5) + переопределяется на конкретной сделке.

5. **Sub-drawer для сделки** (§6): открывать раскрытием внутри модалки клиента (accordion) или отдельным sub-modal'ом поверх? **Default: accordion** — меньше «модалок поверх модалок».

6. **Удаление `/planning/deals` навсегда vs. 410 Gone period**: продовых данных нет → можно сразу удалять. **Default: сразу удалять**, без 410-сохранения.

---

## 2. Открытые вопросы (закрываются параллельно)

Все были закрыты пользователем в предыдущем ответе. Если что-то всплывёт — формируется отдельная мини-секция в этом файле.

---

## 3. Текущий прогресс

| Фаза | Статус | Коммит |
|---|---|---|
| Pre-rework: dev-bypass + dates cleanup | ✅ | `5ede756` |
| P0 | ✅ | `acea9cf` |
| P1 | ✅ | `566e577` |
| P2 | ✅ | `2c56c52` |
| P3 | ✅ | `0919097` |
| P3 audit fix (migration 0030 applied) | ✅ | этой сессией |
| P4 (метрика: weekly storage, факт, variance, redistribute) | ✅ | `26c27b9` |
| P5 (revenue agg + payment UI) | ✅ | `64977b0` |
| P6 (cleanup) | ✅ | этой сессией |
| Build-fix (deploy P0..P6) | ✅ | `6de7a28` + `650add1` + `9ad897f` |
| P7 (недостающие детали фидбэка) | ✅ | `b60ff86` |
| P8 (deals → clients lifecycle) | 📋 план готов | — |

---

## 4. Принципы реализации

1. **Атомарные коммиты**: миграция + типы + API + UI — в одном коммите если они связаны (см. CLAUDE.md правило про атомарность).
2. **Никаких дублирующих абстракций**: используем существующие компоненты `MetricTargetsTable`, `AutoDistributeDialog` где можно.
3. **Optimistic UI везде** (§20.1.2): UI обновляется до ответа сервера, rollback при ошибке.
4. **Тестирование критичных flow** через preview server (dev-bypass активен локально).
5. **Не удалять файлы без явного запроса** (CLAUDE.md правило).
