-- 0040_items_planned_range.sql — P6 из planning_this_week_rework_plan.md.
-- Gantt-like диапазон задач planned_start_date..planned_end_date.

ALTER TABLE public.items
  ADD COLUMN IF NOT EXISTS planned_start_date DATE NULL,
  ADD COLUMN IF NOT EXISTS planned_end_date DATE NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name='items' AND constraint_name='chk_planned_range'
  ) THEN
    ALTER TABLE public.items
      ADD CONSTRAINT chk_planned_range CHECK (
        planned_start_date IS NULL OR planned_end_date IS NULL
        OR planned_end_date >= planned_start_date
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_items_planned_start ON public.items(planned_start_date);
CREATE INDEX IF NOT EXISTS idx_items_planned_end ON public.items(planned_end_date);

-- Backfill: start = end = planned_date
UPDATE public.items
SET planned_start_date = planned_date::date,
    planned_end_date   = planned_date::date
WHERE planned_date IS NOT NULL
  AND planned_start_date IS NULL;

-- Триггер sync_planned_dates: синхронизация planned_date ↔ planned_start_date.
CREATE OR REPLACE FUNCTION public.sync_planned_dates()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF (TG_OP = 'INSERT' OR NEW.planned_start_date IS DISTINCT FROM OLD.planned_start_date) THEN
    NEW.planned_date := NEW.planned_start_date;
  END IF;
  IF NEW.planned_date IS NOT NULL AND NEW.planned_start_date IS NULL THEN
    NEW.planned_start_date := NEW.planned_date::date;
    NEW.planned_end_date := NEW.planned_date::date;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_items_sync_planned_dates ON public.items;
CREATE TRIGGER trg_items_sync_planned_dates
  BEFORE INSERT OR UPDATE ON public.items
  FOR EACH ROW EXECUTE FUNCTION public.sync_planned_dates();
