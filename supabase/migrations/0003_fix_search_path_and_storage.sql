-- Fix: mutable search_path security warning on sqlite_now()
CREATE OR REPLACE FUNCTION public.sqlite_now()
RETURNS text
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS');
$$;

-- Create attachments bucket (private, 50 MB limit, any mime type)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('attachments', 'attachments', false, 52428800, NULL)
ON CONFLICT (id) DO UPDATE
  SET public = EXCLUDED.public,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Storage policies: whitelist-gated (same logic as public.* tables)
DROP POLICY IF EXISTS "attachments_read" ON storage.objects;
DROP POLICY IF EXISTS "attachments_write" ON storage.objects;
DROP POLICY IF EXISTS "attachments_update" ON storage.objects;
DROP POLICY IF EXISTS "attachments_delete" ON storage.objects;

CREATE POLICY "attachments_read" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'attachments' AND public.is_allowed_user());

CREATE POLICY "attachments_write" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'attachments' AND public.is_allowed_user());

CREATE POLICY "attachments_update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'attachments' AND public.is_allowed_user())
  WITH CHECK (bucket_id = 'attachments' AND public.is_allowed_user());

CREATE POLICY "attachments_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'attachments' AND public.is_allowed_user());
