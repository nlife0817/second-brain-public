-- 0039_items_assignee.sql
-- P3 из planning_this_week_rework_plan.md.
-- Исполнитель задачи: assignee_participant_id с дефолтом-триггером (owner).

ALTER TABLE public.items
  ADD COLUMN IF NOT EXISTS assignee_participant_id TEXT NULL
    REFERENCES public.development_participants(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_items_assignee
  ON public.items(assignee_participant_id);

-- Backfill: все существующие items — на owner-участника
UPDATE public.items
SET assignee_participant_id = (
  SELECT id FROM public.development_participants WHERE role = 'owner' LIMIT 1
)
WHERE assignee_participant_id IS NULL;

-- Триггер: дефолтное значение assignee при INSERT
CREATE OR REPLACE FUNCTION public.set_default_assignee()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.assignee_participant_id IS NULL THEN
    NEW.assignee_participant_id := (
      SELECT id FROM public.development_participants WHERE role = 'owner' LIMIT 1
    );
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_items_default_assignee ON public.items;
CREATE TRIGGER trg_items_default_assignee
  BEFORE INSERT ON public.items
  FOR EACH ROW EXECUTE FUNCTION public.set_default_assignee();
