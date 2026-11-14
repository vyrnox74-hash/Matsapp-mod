-- MAtSapp Phase 2 – receipts, typing, presence
-- Safe to run after phase 1

-- Message status already on messages.status: sent | delivered | read
-- Add typing + presence support

CREATE TABLE IF NOT EXISTS public.typing (
  conversation_id TEXT NOT NULL,
  user_phone TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (conversation_id, user_phone)
);

CREATE TABLE IF NOT EXISTS public.presence (
  user_phone TEXT PRIMARY KEY,
  is_online BOOLEAN DEFAULT FALSE,
  last_seen TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.typing ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.presence ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow all typing" ON public.typing;
DROP POLICY IF EXISTS "Allow all presence" ON public.presence;
CREATE POLICY "Allow all typing" ON public.typing FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all presence" ON public.presence FOR ALL USING (true) WITH CHECK (true);

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.typing;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.presence;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Ensure messages has status column
DO $$ BEGIN
  ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'sent';
EXCEPTION WHEN others THEN NULL;
END $$;
