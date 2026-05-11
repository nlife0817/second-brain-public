-- P8: мэппинг lifecycle stages на client_statuses (Пилот, Договор, Не подошел / Мы не подошли).
-- Дефолт pilot_default_duration_days = 30 дней.

ALTER TABLE public.planning_settings
  ADD COLUMN IF NOT EXISTS pilot_status_id text REFERENCES public.client_statuses(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS production_status_id text REFERENCES public.client_statuses(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS churned_status_ids text[] NOT NULL DEFAULT '{}'::text[];

UPDATE public.planning_settings SET
  pilot_status_id = COALESCE(pilot_status_id, (SELECT id FROM public.client_statuses WHERE name = 'Пилот' LIMIT 1)),
  production_status_id = COALESCE(production_status_id, (SELECT id FROM public.client_statuses WHERE name = 'Договор' LIMIT 1)),
  churned_status_ids = CASE
    WHEN COALESCE(array_length(churned_status_ids, 1), 0) = 0
      THEN ARRAY(SELECT id FROM public.client_statuses WHERE name IN ('Не подошел','Мы не подошли'))
    ELSE churned_status_ids
  END,
  pilot_default_duration_days = 30
WHERE id = 'default';
