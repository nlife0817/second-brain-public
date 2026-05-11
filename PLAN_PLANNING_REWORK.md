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

---

## 4. Принципы реализации

1. **Атомарные коммиты**: миграция + типы + API + UI — в одном коммите если они связаны (см. CLAUDE.md правило про атомарность).
2. **Никаких дублирующих абстракций**: используем существующие компоненты `MetricTargetsTable`, `AutoDistributeDialog` где можно.
3. **Optimistic UI везде** (§20.1.2): UI обновляется до ответа сервера, rollback при ошибке.
4. **Тестирование критичных flow** через preview server (dev-bypass активен локально).
5. **Не удалять файлы без явного запроса** (CLAUDE.md правило).
