-- ============================================================
-- MAtSapp Phase 1 – Production messaging foundation
-- Run this in Supabase SQL Editor (safe to re-run parts)
-- ============================================================

-- Ensure profiles exists
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone TEXT UNIQUE NOT NULL,
  display_name TEXT,
  avatar_url TEXT,
  status_text TEXT DEFAULT 'Hey there! I am using MAtSapp.',
  is_admin BOOLEAN DEFAULT FALSE,
  last_seen TIMESTAMPTZ DEFAULT NOW(),
  is_online BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.conversations (
  id TEXT PRIMARY KEY,
  type TEXT DEFAULT 'private',
  title TEXT,
  avatar_url TEXT,
  last_message TEXT,
  last_message_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.conversation_members (
  conversation_id TEXT REFERENCES public.conversations(id) ON DELETE CASCADE,
  user_phone TEXT NOT NULL,
  unread_count INTEGER DEFAULT 0,
  pinned BOOLEAN DEFAULT FALSE,
  archived BOOLEAN DEFAULT FALSE,
  joined_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (conversation_id, user_phone)
);

CREATE TABLE IF NOT EXISTS public.messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id TEXT NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  sender_id TEXT NOT NULL,
  content TEXT,
  type TEXT DEFAULT 'text',
  status TEXT DEFAULT 'sent',  -- sent | delivered | read
  reply_to UUID,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  edited_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS public.app_config (
  id INTEGER PRIMARY KEY DEFAULT 1,
  app_name TEXT DEFAULT 'MAtSapp',
  tagline TEXT DEFAULT 'Connect Beyond Limits',
  welcome_message TEXT DEFAULT '',
  maintenance BOOLEAN DEFAULT FALSE,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO public.app_config (id) VALUES (1)
ON CONFLICT (id) DO NOTHING;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON public.messages(conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_messages_created ON public.messages(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_members_user ON public.conversation_members(user_phone);
CREATE INDEX IF NOT EXISTS idx_profiles_phone ON public.profiles(phone);
CREATE INDEX IF NOT EXISTS idx_conversations_last ON public.conversations(last_message_at DESC);

-- Realtime (ignore error if already added)
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.conversations;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.conversation_members;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- RLS open for Phase 1 testing (tighten later)
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow all profiles" ON public.profiles;
DROP POLICY IF EXISTS "Allow all conversations" ON public.conversations;
DROP POLICY IF EXISTS "Allow all members" ON public.conversation_members;
DROP POLICY IF EXISTS "Allow all messages" ON public.messages;
DROP POLICY IF EXISTS "Allow all config" ON public.app_config;

CREATE POLICY "Allow all profiles" ON public.profiles FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all conversations" ON public.conversations FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all members" ON public.conversation_members FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all messages" ON public.messages FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all config" ON public.app_config FOR ALL USING (true) WITH CHECK (true);

-- Helpful view: latest message per conversation
CREATE OR REPLACE VIEW public.conversation_preview AS
SELECT
  c.id,
  c.type,
  c.title,
  c.last_message,
  c.last_message_at,
  cm.user_phone,
  cm.unread_count,
  cm.pinned,
  cm.archived
FROM public.conversations c
JOIN public.conversation_members cm ON cm.conversation_id = c.id;
