-- Notifications schema: timezone per user, time part on items, push subscriptions, notifications log.

ALTER TABLE public.users ADD COLUMN IF NOT EXISTS timezone TEXT NOT NULL DEFAULT 'Europe/Moscow';

ALTER TABLE public.items ADD COLUMN IF NOT EXISTS due_time TEXT;

CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id TEXT PRIMARY KEY,
  user_email TEXT NOT NULL REFERENCES public.users(email) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  user_agent TEXT,
  created_at TEXT NOT NULL DEFAULT public.sqlite_now(),
  updated_at TEXT NOT NULL DEFAULT public.sqlite_now()
);
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user ON public.push_subscriptions(user_email);

CREATE TABLE IF NOT EXISTS public.notifications_log (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('overdue_hour', 'date_only_morning', 'daily_summary')),
  target_id TEXT NOT NULL,
  user_email TEXT NOT NULL,
  sent_at TEXT NOT NULL DEFAULT public.sqlite_now(),
  UNIQUE (type, target_id, user_email)
);
CREATE INDEX IF NOT EXISTS idx_notifications_log_user ON public.notifications_log(user_email);

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "allowed_users_all" ON public.push_subscriptions;
CREATE POLICY "allowed_users_all" ON public.push_subscriptions
  FOR ALL TO authenticated
  USING (public.is_allowed_user())
  WITH CHECK (public.is_allowed_user());

DROP POLICY IF EXISTS "allowed_users_all" ON public.notifications_log;
CREATE POLICY "allowed_users_all" ON public.notifications_log
  FOR ALL TO authenticated
  USING (public.is_allowed_user())
  WITH CHECK (public.is_allowed_user());
