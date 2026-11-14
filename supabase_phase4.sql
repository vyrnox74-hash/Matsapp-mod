-- MAtSapp Phase 4 – Groups, Status, Communities
-- Run in Supabase SQL Editor

-- Status updates (24h)
CREATE TABLE IF NOT EXISTS public.statuses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_phone TEXT NOT NULL,
  type TEXT DEFAULT 'text',          -- text | image
  content TEXT,
  media_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '24 hours')
);

CREATE INDEX IF NOT EXISTS idx_statuses_user ON public.statuses(user_phone);
CREATE INDEX IF NOT EXISTS idx_statuses_expires ON public.statuses(expires_at);

CREATE TABLE IF NOT EXISTS public.status_views (
  status_id UUID REFERENCES public.statuses(id) ON DELETE CASCADE,
  viewer_phone TEXT NOT NULL,
  viewed_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (status_id, viewer_phone)
);

-- Groups use conversations.type = 'group' + conversation_members
-- Add group fields if missing
DO $$ BEGIN
  ALTER TABLE public.conversations ADD COLUMN IF NOT EXISTS description TEXT;
  ALTER TABLE public.conversations ADD COLUMN IF NOT EXISTS created_by TEXT;
EXCEPTION WHEN others THEN NULL;
END $$;

-- Communities
CREATE TABLE IF NOT EXISTS public.communities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  avatar_url TEXT,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.community_members (
  community_id UUID REFERENCES public.communities(id) ON DELETE CASCADE,
  user_phone TEXT NOT NULL,
  role TEXT DEFAULT 'member',
  joined_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (community_id, user_phone)
);

-- Link groups to communities (optional)
DO $$ BEGIN
  ALTER TABLE public.conversations ADD COLUMN IF NOT EXISTS community_id UUID;
EXCEPTION WHEN others THEN NULL;
END $$;

ALTER TABLE public.statuses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.status_views ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.communities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.community_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow all statuses" ON public.statuses;
DROP POLICY IF EXISTS "Allow all status_views" ON public.status_views;
DROP POLICY IF EXISTS "Allow all communities" ON public.communities;
DROP POLICY IF EXISTS "Allow all community_members" ON public.community_members;

CREATE POLICY "Allow all statuses" ON public.statuses FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all status_views" ON public.status_views FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all communities" ON public.communities FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all community_members" ON public.community_members FOR ALL USING (true) WITH CHECK (true);

DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.statuses;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.communities;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
