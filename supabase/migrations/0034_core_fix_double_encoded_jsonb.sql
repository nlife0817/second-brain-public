-- Починка jsonb-колонок, записанных с двойным кодированием.
--
-- Причина — в приложении (см. serializeJson в src/lib/sql.ts): готовый
-- JSON-текст уходил в `?::jsonb`, а postgres.js кодировал его ещё раз, когда
-- успевал узнать тип параметра. В колонке вместо массива/объекта оказывалась
-- jsonb-строка: '[]' превращалось в '"[]"'. Приём приглашения на такой строке
-- падал с UNDEFINED_VALUE — обход `for..of` шёл по символам.
--
-- Разворачиваем обратно: `#>> '{}'` достаёт из jsonb-строки исходный текст,
-- `::jsonb` разбирает его как положено. Условие по '^\s*[\[{]' страхует от
-- строк, которые просто похожи на испорченные: трогаем только те, внутри
-- которых действительно лежит массив или объект.
--
-- core.task_field_values.value сознательно НЕ трогаем: там jsonb-строка —
-- законное значение (текстовое пользовательское поле), и такая же «починка»
-- испортила бы настоящие данные.

update core.invitations
   set project_grants = (project_grants #>> '{}')::jsonb
 where jsonb_typeof(project_grants) = 'string'
   and (project_grants #>> '{}') ~ '^\s*[\[{]';

update core.events
   set payload = (payload #>> '{}')::jsonb
 where jsonb_typeof(payload) = 'string'
   and (payload #>> '{}') ~ '^\s*[\[{]';

update core.organizations
   set settings = (settings #>> '{}')::jsonb
 where jsonb_typeof(settings) = 'string'
   and (settings #>> '{}') ~ '^\s*[\[{]';

update core.custom_fields
   set options = (options #>> '{}')::jsonb
 where jsonb_typeof(options) = 'string'
   and (options #>> '{}') ~ '^\s*[\[{]';

update core.webhooks
   set events = (events #>> '{}')::jsonb
 where jsonb_typeof(events) = 'string'
   and (events #>> '{}') ~ '^\s*[\[{]';

update core.recurring_rules
   set template = (template #>> '{}')::jsonb
 where jsonb_typeof(template) = 'string'
   and (template #>> '{}') ~ '^\s*[\[{]';

update core.recurring_rules
   set byweekday = (byweekday #>> '{}')::jsonb
 where byweekday is not null
   and jsonb_typeof(byweekday) = 'string'
   and (byweekday #>> '{}') ~ '^\s*[\[{]';
