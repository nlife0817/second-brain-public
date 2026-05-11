-- ============================================================================
-- 0027: Tasks ↔ Initiatives — many-to-many
-- ============================================================================
-- Концепт §3.6 предполагал items.initiative_id (1:N). По решению пользователя
-- задача может быть привязана к нескольким инициативам. Создаём join-таблицу
-- и переносим существующие связи. Колонка items.initiative_id остаётся для
-- обратной совместимости (UI читает из M:N через join).
--
-- Подзадачи (items с parent_id != null) в M:N не привязываются напрямую —
-- они появляются в списке инициативы автоматически если parent привязан
-- (фильтрация на стороне API/UI).
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.planning_item_initiative_link (
  item_id TEXT NOT NULL REFERENCES public.items(id) ON DELETE CASCADE,
  initiative_id UUID NOT NULL REFERENCES public.planning_initiatives(id) ON DELETE CASCADE,
  linked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (item_id, initiative_id)
);

CREATE INDEX IF NOT EXISTS idx_piil_item ON public.planning_item_initiative_link (item_id);
CREATE INDEX IF NOT EXISTS idx_piil_initiative ON public.planning_item_initiative_link (initiative_id);

-- Backfill: переносим existing items.initiative_id → join
INSERT INTO public.planning_item_initiative_link (item_id, initiative_id)
SELECT id, initiative_id
FROM public.items
WHERE initiative_id IS NOT NULL
ON CONFLICT (item_id, initiative_id) DO NOTHING;

-- RLS
DROP POLICY IF EXISTS "allowed_users_all" ON public.planning_item_initiative_link;
CREATE POLICY "allowed_users_all" ON public.planning_item_initiative_link
  FOR ALL TO authenticated
  USING (public.is_allowed_user())
  WITH CHECK (public.is_allowed_user());

ALTER TABLE public.planning_item_initiative_link ENABLE ROW LEVEL SECURITY;

-- Realtime
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.planning_item_initiative_link;
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN object_not_in_prerequisite_state THEN NULL;
END $$;
