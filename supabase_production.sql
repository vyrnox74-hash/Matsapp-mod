-- ============================================================
-- MAtSapp PRODUCTION: Auth linkage + tighter RLS + private storage notes
-- Run AFTER you enable Phone Auth in Supabase Dashboard
-- ============================================================

-- Profiles linked to auth.users (when using Supabase Auth)
DO $$ BEGIN
  ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS user_id UUID UNIQUE;
EXCEPTION WHEN others THEN NULL;
END $$;

-- Push subscriptions
CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_phone TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  p256dh TEXT,
  auth TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_phone, endpoint)
);

CREATE INDEX IF NOT EXISTS idx_push_user ON public.push_subscriptions(user_phone);

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all push" ON public.push_subscriptions;
CREATE POLICY "Allow all push" ON public.push_subscriptions FOR ALL USING (true) WITH CHECK (true);

-- Optional: helper to resolve phone from JWT user metadata
-- Prefer setting phone in raw_user_meta_data / app_metadata on signup

-- ------------------------------------------------------------
-- TIGHTER RLS (enable when AUTH_MODE = supabase and tested)
-- Uncomment after migrating logins to Supabase Auth.
-- ------------------------------------------------------------

/*
-- Drop open policies
DROP POLICY IF EXISTS "Allow all profiles" ON public.profiles;
DROP POLICY IF EXISTS "Allow all conversations" ON public.conversations;
DROP POLICY IF EXISTS "Allow all members" ON public.conversation_members;
DROP POLICY IF EXISTS "Allow all messages" ON public.messages;

-- Profiles: users can read all (for contact names) but update only self
CREATE POLICY "profiles_select" ON public.profiles FOR SELECT USING (true);
CREATE POLICY "profiles_upsert_self" ON public.profiles FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "profiles_update_self" ON public.profiles FOR UPDATE
  USING (
    user_id = auth.uid()
    OR phone = (auth.jwt() ->> 'phone')
  );

-- Conversation members: only see own memberships
CREATE POLICY "members_select_own" ON public.conversation_members FOR SELECT
  USING (
    user_phone = (auth.jwt() ->> 'phone')
    OR EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = auth.uid() AND p.phone = conversation_members.user_phone
    )
  );
CREATE POLICY "members_insert" ON public.conversation_members FOR INSERT WITH CHECK (true);
CREATE POLICY "members_update_own" ON public.conversation_members FOR UPDATE
  USING (user_phone = (auth.jwt() ->> 'phone'));

-- Conversations: visible if member
CREATE POLICY "conv_select_member" ON public.conversations FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.conversation_members cm
      WHERE cm.conversation_id = id
        AND (
          cm.user_phone = (auth.jwt() ->> 'phone')
          OR cm.user_phone IN (SELECT phone FROM public.profiles WHERE user_id = auth.uid())
        )
    )
  );
CREATE POLICY "conv_insert" ON public.conversations FOR INSERT WITH CHECK (true);
CREATE POLICY "conv_update_member" ON public.conversations FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.conversation_members cm
      WHERE cm.conversation_id = id
        AND cm.user_phone = (auth.jwt() ->> 'phone')
    )
  );

-- Messages: only members of conversation
CREATE POLICY "msg_select_member" ON public.messages FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.conversation_members cm
      WHERE cm.conversation_id = messages.conversation_id
        AND cm.user_phone = (auth.jwt() ->> 'phone')
    )
  );
CREATE POLICY "msg_insert_member" ON public.messages FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.conversation_members cm
      WHERE cm.conversation_id = messages.conversation_id
        AND cm.user_phone = (auth.jwt() ->> 'phone')
    )
  );
CREATE POLICY "msg_update_member" ON public.messages FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.conversation_members cm
      WHERE cm.conversation_id = messages.conversation_id
        AND cm.user_phone = (auth.jwt() ->> 'phone')
    )
  );
*/

-- Storage: make bucket private in Dashboard → Storage → chat-media → Public: OFF
-- Then add policies (Storage policies UI or SQL on storage.objects):
/*
CREATE POLICY "chat media read authenticated" ON storage.objects
  FOR SELECT TO authenticated USING (bucket_id = 'chat-media');
CREATE POLICY "chat media upload authenticated" ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (bucket_id = 'chat-media');
*/
