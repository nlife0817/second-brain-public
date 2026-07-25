-- Убрать таблицы v1 из публикации Realtime.
--
-- В supabase_realtime лежали 39 таблиц схемы public — наследие v1, где сетку
-- обновляла подписка Realtime (lib/realtime.ts, lib/store.ts). Postgres считал
-- для них логическую репликацию постоянно: в pg_stat_statements опрос WAL —
-- самый дорогой запрос базы (1.33 млн вызовов, 10 834 секунды процессорного
-- времени против единиц секунд у любого запроса приложения).
--
-- v1 отключён (миграция 0034 и proxy), и на Realtime он больше не подписывается.
-- v2 не подписан на него вовсе — ни одного вызова из lib/core.
--
-- Таблицы схемы core в публикации ОСТАЮТСЯ: их там семь, они дёшевы, и это
-- задел под живые обновления в v2 (RLS-политики ядра написаны в расчёте на них).
--
-- Обратный ход: alter publication supabase_realtime add table public.<имя>.

do $$
declare
  r record;
  v_count int := 0;
begin
  for r in
    select schemaname, tablename
    from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public'
    order by tablename
  loop
    execute format(
      'alter publication supabase_realtime drop table %I.%I',
      r.schemaname, r.tablename
    );
    v_count := v_count + 1;
  end loop;
  raise notice 'из публикации убрано таблиц схемы public: %', v_count;
end $$;
