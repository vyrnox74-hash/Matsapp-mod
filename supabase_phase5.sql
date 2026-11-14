-- MAtSapp Phase 5 – Call signaling records (optional history)
CREATE TABLE IF NOT EXISTS public.calls (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  caller_phone TEXT NOT NULL,
  callee_phone TEXT NOT NULL,
  type TEXT DEFAULT 'voice', -- voice | video
  status TEXT DEFAULT 'ringing', -- ringing | accepted | rejected | ended | missed
  started_at TIMESTAMPTZ DEFAULT NOW(),
  ended_at TIMESTAMPTZ,
  duration_sec INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_calls_caller ON public.calls(caller_phone);
CREATE INDEX IF NOT EXISTS idx_calls_callee ON public.calls(callee_phone);

ALTER TABLE public.calls ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all calls" ON public.calls;
CREATE POLICY "Allow all calls" ON public.calls FOR ALL USING (true) WITH CHECK (true);

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.calls;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
