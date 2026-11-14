-- MAtSapp contacts sync table
CREATE TABLE IF NOT EXISTS public.user_contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_phone TEXT NOT NULL,
  contact_phone TEXT NOT NULL,
  contact_name TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (owner_phone, contact_phone)
);

CREATE INDEX IF NOT EXISTS idx_user_contacts_owner ON public.user_contacts(owner_phone);

ALTER TABLE public.user_contacts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all user_contacts" ON public.user_contacts;
CREATE POLICY "Allow all user_contacts" ON public.user_contacts FOR ALL USING (true) WITH CHECK (true);
