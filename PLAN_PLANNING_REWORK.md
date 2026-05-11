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

### P2 — Колонка инициатив

- [ ] Period cascade-фильтр: Q → M → W. По умолчанию — текущий период. Логика «пересечения» (initiative.start_period_id..end_period_id ∩ filter_period).
- [ ] Badge «просрочена» для инициатив где `now() > end_period.end_date` и `status != 'done'`. Подсветка красным.
- [ ] Кастомный недельный picker — компактный grid `4 quarter × 13 week` с подсветкой текущей недели и диапазона.

### P3 — Колонка задач (КРИТИЧНО)

- [ ] Удалить «создание задачи с нуля» из TaskColumn
- [ ] Заменить на:
   1. По умолчанию — items, привязанные к выбранной инициативе (через M:N link table)
   2. Колонки items как в /m/tasks: title, status, est, why, ...
   3. Filter/group/sort расширенные
   4. Кнопка «Привязать задачи» открывает picker с тем же UI + чекбоксы
   5. Подзадачи (items.parent_id != null) показываются автоматически если parent в инициативе
- [ ] Open задачу в модалке (TaskDetail), без inline-редактирования в таблице
- [ ] Добавить «привязать к инициативе» из drawer'а самой задачи

### P4 — Метрика (источник факта и редактирование)

- [ ] Auto-distribute → только по неделям (52). Quarter/Month = SUM view
- [ ] `MetricActualsTable` для metric.source=`manual` — editable «факт по периоду» с теми же горизонтами
- [ ] Для `source=second_brain` для бизнес-метрик «Выручка» — server-side агрегатор на основе `planning_deal_payments` (status IN ('expected','confirmed'))
- [ ] Variance indicator в drawer'е и на metric card: `Δ vs план YTD`
- [ ] Кнопка «Перераспределить недобор» (manual, без автомата): открывает distribute dialog с pre-filled gap

### P5 — Сделки (entity внутри Clients)

- [ ] Page `/clients/[id]/deals` или вкладка «Сделки» на странице клиента
- [ ] CRUD сделок: title, stage, dates, amounts, description
- [ ] Auto-fill stage timestamps при смене stage (§6.7.5)
- [ ] Auto-recurring payments cron (§6.7.2): для stage=production создаёт ежемесячные `expected` записи
- [ ] UI редактирования платежей: edit `amount`, статус `expected→confirmed` по кнопке
- [ ] Подсчёт metric «Выручка» — суммирование `deal_payments` по периодам
- [ ] Initiative-linked deals: на странице сделки видна привязка к инициативам, что её блокирует

### P6 — Полишинг и тех-долг

- [ ] Удалить мёртвую таблицу `planning_initiative_dependency` (migration drop) после подтверждения что нигде не используется
- [ ] Удалить старый `weekly-plans` API + `src/components/weekly/*` (§17 концепта)
- [ ] Полировка empty states по §20.1.4

---

## 2. Открытые вопросы (закрываются параллельно)

Все были закрыты пользователем в предыдущем ответе. Если что-то всплывёт — формируется отдельная мини-секция в этом файле.

---

## 3. Текущий прогресс

| Фаза | Статус | Коммит |
|---|---|---|
| Pre-rework: dev-bypass + dates cleanup | ✅ | `5ede756` |
| P0 | ✅ | `acea9cf` |
| P1 | ✅ | — (этой сессией) |
| P2..P6 | ⏳ pending | — |

---

## 4. Принципы реализации

1. **Атомарные коммиты**: миграция + типы + API + UI — в одном коммите если они связаны (см. CLAUDE.md правило про атомарность).
2. **Никаких дублирующих абстракций**: используем существующие компоненты `MetricTargetsTable`, `AutoDistributeDialog` где можно.
3. **Optimistic UI везде** (§20.1.2): UI обновляется до ответа сервера, rollback при ошибке.
4. **Тестирование критичных flow** через preview server (dev-bypass активен локально).
5. **Не удалять файлы без явного запроса** (CLAUDE.md правило).
