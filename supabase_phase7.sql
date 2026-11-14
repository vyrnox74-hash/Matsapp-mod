-- MAtSapp Phase 7 – Admin support
-- Ensure profiles has is_admin; app_config exists from phase 1

DO $$ BEGIN
  ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS is_admin BOOLEAN DEFAULT FALSE;
  ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS is_suspended BOOLEAN DEFAULT FALSE;
EXCEPTION WHEN others THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS public.reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_phone TEXT,
  reported_phone TEXT,
  conversation_id TEXT,
  reason TEXT,
  status TEXT DEFAULT 'open', -- open | reviewed | closed
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.admin_announcements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT,
  body TEXT NOT NULL,
  created_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  active BOOLEAN DEFAULT TRUE
);

ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_announcements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow all reports" ON public.reports;
DROP POLICY IF EXISTS "Allow all announcements" ON public.admin_announcements;
CREATE POLICY "Allow all reports" ON public.reports FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all announcements" ON public.admin_announcements FOR ALL USING (true) WITH CHECK (true);

-- Promote a number to admin (change phone as needed):
-- UPDATE public.profiles SET is_admin = true WHERE phone = '+2567XXXXXXXX';
