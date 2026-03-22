-- App users table (Clerk id) + daily session cap reset (see src/lib/session-cap.ts)
-- Safe to re-run: IF NOT EXISTS everywhere.

CREATE TABLE IF NOT EXISTS public.users (
  id text PRIMARY KEY,
  daily_cap_reset_at timestamptz DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS daily_cap_reset_at timestamptz DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_users_daily_cap_reset ON public.users (daily_cap_reset_at);

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role can manage users" ON public.users;
CREATE POLICY "Service role can manage users"
  ON public.users FOR ALL
  USING (current_setting('role')::text = 'service_role')
  WITH CHECK (current_setting('role')::text = 'service_role');
