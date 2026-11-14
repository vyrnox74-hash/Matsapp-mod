-- MAtSapp Phase 3 – Media support
-- Run in Supabase SQL Editor AFTER creating storage buckets in Dashboard

-- Extra columns on messages for media
DO $$ BEGIN
  ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS media_url TEXT;
  ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS media_mime TEXT;
  ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS media_size BIGINT;
  ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS media_duration INTEGER;
EXCEPTION WHEN others THEN NULL;
END $$;

-- NOTE: Create these buckets in Supabase Dashboard → Storage:
-- 1. avatars   (public)
-- 2. chat-media (public or private with signed URLs)
--
-- For each bucket, add policy (Storage → Policies) or run:

-- Example storage policies (adjust if using storage schema APIs):
-- Allow authenticated/anon upload & read for Phase 3 testing
-- Prefer tightening later.

-- If using SQL on storage.objects:
-- CREATE POLICY "Public read chat-media" ON storage.objects
--   FOR SELECT USING (bucket_id = 'chat-media');
-- CREATE POLICY "Public upload chat-media" ON storage.objects
--   FOR INSERT WITH CHECK (bucket_id = 'chat-media');
-- CREATE POLICY "Public read avatars" ON storage.objects
--   FOR SELECT USING (bucket_id = 'avatars');
-- CREATE POLICY "Public upload avatars" ON storage.objects
--   FOR INSERT WITH CHECK (bucket_id = 'avatars');
