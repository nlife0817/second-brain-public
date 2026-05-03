-- Goals enhancements:
--   1) allow comments on goals (extend comments.entity_type CHECK)
--   2) seed system relation type 'contributes_to_goal' for goal->goal cross-linking

ALTER TABLE public.comments DROP CONSTRAINT IF EXISTS comments_entity_type_check;
ALTER TABLE public.comments ADD CONSTRAINT comments_entity_type_check
  CHECK (entity_type IN ('item','client','goal'));

INSERT INTO public.relation_types (id, name, color, icon, position, is_system)
VALUES ('contributes_to_goal', 'Вкладывается в цель', '#a855f7', 'TrendingUp', 101, 1)
ON CONFLICT (id) DO NOTHING;
