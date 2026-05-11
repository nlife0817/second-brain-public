-- 0041_item_plan_history.sql — P7 из planning_this_week_rework_plan.md.
-- История переносов + original_planned_start_date.

ALTER TABLE public.items
  ADD COLUMN IF NOT EXISTS original_planned_start_date DATE NULL;

UPDATE public.items
SET original_planned_start_date = planned_start_date
WHERE planned_start_date IS NOT NULL
  AND original_planned_start_date IS NULL;

CREATE TABLE IF NOT EXISTS public.planning_item_plan_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id TEXT NOT NULL REFERENCES public.items(id) ON DELETE CASCADE,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  changed_by TEXT NULL,
  planned_start_before DATE NULL,
  planned_end_before DATE NULL,
  planned_period_id_before UUID NULL,
  assignee_before TEXT NULL,
  planned_start_after DATE NULL,
  planned_end_after DATE NULL,
  planned_period_id_after UUID NULL,
  assignee_after TEXT NULL,
  reason_code TEXT NULL REFERENCES public.planning_replan_reasons(code),
  reason_text TEXT NULL
);

CREATE INDEX IF NOT EXISTS idx_iph_item ON public.planning_item_plan_history(item_id, changed_at DESC);
CREATE INDEX IF NOT EXISTS idx_iph_changed_at ON public.planning_item_plan_history(changed_at DESC);

ALTER TABLE public.planning_item_plan_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allowed_users_all" ON public.planning_item_plan_history;
CREATE POLICY "allowed_users_all" ON public.planning_item_plan_history
  FOR ALL TO authenticated
  USING (public.is_allowed_user())
  WITH CHECK (public.is_allowed_user());

-- Триггер log_item_plan_change: записывает запись в history при изменении
-- планировочных полей задачи, которая уже была запланирована (OLD.start IS NOT NULL).
-- Причина читается из app.replan_reason_code/app.replan_reason_text (SET LOCAL из API).
CREATE OR REPLACE FUNCTION public.log_item_plan_change()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_changed BOOLEAN;
  v_reason_code TEXT;
  v_reason_text TEXT;
  v_user_email TEXT;
BEGIN
  v_changed :=
       NEW.planned_start_date IS DISTINCT FROM OLD.planned_start_date
    OR NEW.planned_end_date IS DISTINCT FROM OLD.planned_end_date
    OR NEW.planned_period_id IS DISTINCT FROM OLD.planned_period_id
    OR NEW.assignee_participant_id IS DISTINCT FROM OLD.assignee_participant_id;

  IF v_changed AND OLD.planned_start_date IS NOT NULL THEN
    BEGIN v_reason_code := current_setting('app.replan_reason_code', true); EXCEPTION WHEN OTHERS THEN v_reason_code := NULL; END;
    BEGIN v_reason_text := current_setting('app.replan_reason_text', true); EXCEPTION WHEN OTHERS THEN v_reason_text := NULL; END;
    BEGIN v_user_email := current_setting('app.user_email', true); EXCEPTION WHEN OTHERS THEN v_user_email := NULL; END;

    INSERT INTO public.planning_item_plan_history (
      item_id, changed_at, changed_by,
      planned_start_before, planned_end_before, planned_period_id_before, assignee_before,
      planned_start_after,  planned_end_after,  planned_period_id_after,  assignee_after,
      reason_code, reason_text
    ) VALUES (
      NEW.id, now(), NULLIF(v_user_email, ''),
      OLD.planned_start_date, OLD.planned_end_date, OLD.planned_period_id, OLD.assignee_participant_id,
      NEW.planned_start_date, NEW.planned_end_date, NEW.planned_period_id, NEW.assignee_participant_id,
      NULLIF(v_reason_code, ''),
      NULLIF(v_reason_text, '')
    );
  END IF;

  IF NEW.planned_start_date IS NOT NULL AND NEW.original_planned_start_date IS NULL THEN
    NEW.original_planned_start_date := NEW.planned_start_date;
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_items_log_plan_change ON public.items;
CREATE TRIGGER trg_items_log_plan_change
  BEFORE UPDATE ON public.items
  FOR EACH ROW EXECUTE FUNCTION public.log_item_plan_change();
