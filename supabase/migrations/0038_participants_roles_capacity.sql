-- 0038_participants_roles_capacity.sql
-- P2 из planning_this_week_rework_plan.md.
-- Расширяем development_participants ролью / активностью / часами по умолчанию.
-- Добавляем per-week override-таблицу planning_participant_capacity.

-- 1. Новые поля на участнике
ALTER TABLE public.development_participants
  ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'developer'
    CHECK (role IN ('developer','owner','other'));

ALTER TABLE public.development_participants
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE public.development_participants
  ADD COLUMN IF NOT EXISTS deactivated_at TIMESTAMPTZ NULL;

ALTER TABLE public.development_participants
  ADD COLUMN IF NOT EXISTS weekly_hours_default NUMERIC NOT NULL DEFAULT 40
    CHECK (weekly_hours_default >= 0);

-- Только один owner-участник
CREATE UNIQUE INDEX IF NOT EXISTS uniq_one_owner_participant
  ON public.development_participants(role)
  WHERE role = 'owner';

-- 2. Сид owner-участника «Я», если ни одного нет
INSERT INTO public.development_participants (id, name, role, weekly_hours_default, position)
SELECT 'owner-self', 'Я', 'owner', 40, -1
WHERE NOT EXISTS (
  SELECT 1 FROM public.development_participants WHERE role = 'owner'
);

-- 3. Per-week override capacity
CREATE TABLE IF NOT EXISTS public.planning_participant_capacity (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  participant_id TEXT NOT NULL REFERENCES public.development_participants(id) ON DELETE CASCADE,
  period_id UUID NOT NULL REFERENCES public.planning_periods(id) ON DELETE CASCADE,
  hours_override NUMERIC NULL CHECK (hours_override IS NULL OR hours_override >= 0),
  is_active_override BOOLEAN NULL,
  note TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (participant_id, period_id)
);

CREATE INDEX IF NOT EXISTS idx_ppc_period ON public.planning_participant_capacity(period_id);
CREATE INDEX IF NOT EXISTS idx_ppc_participant ON public.planning_participant_capacity(participant_id);

-- 4. RLS — стандартная политика allowed_users_all
ALTER TABLE public.planning_participant_capacity ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allowed_users_all" ON public.planning_participant_capacity;
CREATE POLICY "allowed_users_all" ON public.planning_participant_capacity
  FOR ALL TO authenticated
  USING (public.is_allowed_user())
  WITH CHECK (public.is_allowed_user());

-- 5. Триггер updated_at
CREATE OR REPLACE FUNCTION public.touch_ppc_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_ppc_touch_updated_at ON public.planning_participant_capacity;
CREATE TRIGGER trg_ppc_touch_updated_at
  BEFORE UPDATE ON public.planning_participant_capacity
  FOR EACH ROW EXECUTE FUNCTION public.touch_ppc_updated_at();
