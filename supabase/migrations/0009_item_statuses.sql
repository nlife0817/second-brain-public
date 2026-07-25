-- Move task statuses out of the hardcoded TS union into a user-editable
-- table. The 6 legacy keys (inbox/todo/in_progress/review/done/archived)
-- are seeded as the initial rows so existing items.status values keep
-- working unchanged. The CHECK constraint is dropped so new statuses
-- can be added by the user without further schema migrations.
--
-- `kind` carries the well-known semantics that the app branches on
-- (overdue calc, archived filter, etc.):
--   open      — regular working state (default for any new custom status)
--   done      — completed/closed; treated as not-overdue
--   archived  — hidden from the main list unless showArchived is on

CREATE TABLE IF NOT EXISTS public.item_statuses (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  color       TEXT NOT NULL DEFAULT '#94a3b8',
  position    INTEGER NOT NULL DEFAULT 0,
  kind        TEXT NOT NULL DEFAULT 'open' CHECK (kind IN ('open', 'done', 'archived')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed legacy statuses with their TS keys as IDs so existing items rows
-- keep referencing the same string values. Colors mirror the previous
-- STATUS_CONFIG palette so the UI doesn't change appearance for existing
-- users post-migration.
INSERT INTO public.item_statuses (id, name, color, position, kind)
VALUES
  ('inbox',       'Входящие',      '#94a3b8', 0, 'open'),
  ('todo',        'К выполнению',  '#3b82f6', 1, 'open'),
  ('in_progress', 'В работе',      '#f59e0b', 2, 'open'),
  ('review',      'На проверке',   '#a855f7', 3, 'open'),
  ('done',        'Готово',        '#10b981', 4, 'done'),
  ('archived',    'Архив',         '#64748b', 5, 'archived')
ON CONFLICT (id) DO NOTHING;

-- Drop the legacy CHECK constraint so user-created status IDs can be
-- written to items.status. App-level validation now governs which IDs
-- are accepted (status must exist in item_statuses).
ALTER TABLE public.items DROP CONSTRAINT IF EXISTS items_status_check;

-- Apply the standard "allowed users full access" RLS policy to the new
-- table (RLS is auto-enabled by the event trigger from 0006).
DROP POLICY IF EXISTS "allowed_users_all" ON public.item_statuses;
CREATE POLICY "allowed_users_all" ON public.item_statuses
  FOR ALL TO authenticated
  USING (public.is_allowed_user())
  WITH CHECK (public.is_allowed_user());

-- Publish to Realtime so other sessions see status edits in real time.
ALTER PUBLICATION supabase_realtime ADD TABLE public.item_statuses;
