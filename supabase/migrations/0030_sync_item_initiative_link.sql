-- ============================================================================
-- 0030: trigger items.initiative_id ↔ planning_item_initiative_link
-- ============================================================================
-- В P0 (0027) M:N-таблица заведена и заполнена backfill'ом. Но существующий
-- код (autoLinkOrphanTaskToSupport, /api/items PUT с initiative_id, синки)
-- продолжает писать в items.initiative_id. Триггер мостит этот legacy-путь
-- к M:N — чтобы UI планирования, читающий из M:N, видел все привязки.
--
-- Семантика: items.initiative_id — это «primary» инициатива (одна).
-- Меняем её A→B: удаляем M:N(A) и добавляем M:N(B). Любые дополнительные
-- M:N-привязки (которые UI планирования добавляет руками) остаются нетронутыми.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.sync_item_initiative_link() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.initiative_id IS NOT NULL THEN
      INSERT INTO public.planning_item_initiative_link (item_id, initiative_id)
      VALUES (NEW.id, NEW.initiative_id)
      ON CONFLICT (item_id, initiative_id) DO NOTHING;
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE
  IF OLD.initiative_id IS DISTINCT FROM NEW.initiative_id THEN
    IF OLD.initiative_id IS NOT NULL THEN
      DELETE FROM public.planning_item_initiative_link
       WHERE item_id = NEW.id AND initiative_id = OLD.initiative_id;
    END IF;
    IF NEW.initiative_id IS NOT NULL THEN
      INSERT INTO public.planning_item_initiative_link (item_id, initiative_id)
      VALUES (NEW.id, NEW.initiative_id)
      ON CONFLICT (item_id, initiative_id) DO NOTHING;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS sync_item_initiative_link_trg ON public.items;
CREATE TRIGGER sync_item_initiative_link_trg
  AFTER INSERT OR UPDATE OF initiative_id ON public.items
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_item_initiative_link();
