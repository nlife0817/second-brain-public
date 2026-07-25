-- Idempotency for timer start: client supplies a UUID per Start click; if the
-- request is retried (flaky mobile network) we return the existing row instead
-- of creating a duplicate that mutex_replace would then immediately close.

ALTER TABLE public.time_entries
  ADD COLUMN IF NOT EXISTS client_request_id TEXT;

-- Partial unique: NULLs are allowed (legacy rows / non-idempotent inserts),
-- but any non-null value must be unique per user.
CREATE UNIQUE INDEX IF NOT EXISTS time_entries_client_request_id_uniq
  ON public.time_entries (user_email, client_request_id)
  WHERE client_request_id IS NOT NULL;
