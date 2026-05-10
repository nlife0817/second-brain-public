-- Recurring task series: a template + rule that materialises into N concrete `items`.
-- Each generated instance is a regular row in `items` linked back via `recurring_series_id`.
-- Push notifications, filters, kanban etc. work unchanged because instances are normal items.

CREATE TABLE IF NOT EXISTS public.recurring_series (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Шаблон полей задачи (применяется при генерации каждого экземпляра).
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  type TEXT NOT NULL DEFAULT 'task',
  status TEXT NOT NULL DEFAULT 'todo',
  priority TEXT NOT NULL DEFAULT 'none',
  category TEXT NOT NULL DEFAULT 'other',
  due_time TEXT,
  estimated_minutes INT,

  -- Правило повторения.
  freq TEXT NOT NULL CHECK (freq IN ('daily','weekdays','weekly','monthly','yearly')),
  interval INT NOT NULL DEFAULT 1 CHECK (interval >= 1),
  byweekday JSONB,          -- массив 0..6 (вс..сб) для freq='weekly'
  bymonthday INT,           -- день месяца для freq='monthly' (NULL → день из start_date)

  start_date DATE NOT NULL,
  until_date DATE NOT NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT recurring_series_until_after_start CHECK (until_date >= start_date)
);

-- Связь экземпляра с серией. ON DELETE SET NULL — удаление серии не каскадит на items.
-- Действительное удаление будущих/всех экземпляров делается явно из API.
ALTER TABLE public.items
  ADD COLUMN IF NOT EXISTS recurring_series_id UUID
  REFERENCES public.recurring_series(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_items_recurring_series_id
  ON public.items(recurring_series_id)
  WHERE recurring_series_id IS NOT NULL;

-- RLS (event trigger из 0006 уже включит RLS, но политики надо завести явно).
DROP POLICY IF EXISTS "allowed_users_all" ON public.recurring_series;
CREATE POLICY "allowed_users_all" ON public.recurring_series
  FOR ALL TO authenticated
  USING (public.is_allowed_user())
  WITH CHECK (public.is_allowed_user());
