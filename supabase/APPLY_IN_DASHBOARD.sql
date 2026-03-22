-- Run this in Supabase → SQL Editor if you are not using the CLI migration runner.
-- Order matters: session_outcomes → session_feedback → users.
-- Idempotent: safe to re-run.

-- ========== session_outcomes (notes: "After the real conversation") ==========
CREATE TABLE IF NOT EXISTS public.session_outcomes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES public.sessions (id) ON DELETE CASCADE,
  outcome TEXT NOT NULL CHECK (outcome IN ('well', 'tough')),
  user_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT session_outcomes_session_unique UNIQUE (session_id)
);

CREATE INDEX IF NOT EXISTS idx_session_outcomes_session_id ON public.session_outcomes (session_id);
CREATE INDEX IF NOT EXISTS idx_session_outcomes_created_at ON public.session_outcomes (created_at DESC);

ALTER TABLE public.session_outcomes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role can manage session outcomes" ON public.session_outcomes;
CREATE POLICY "Service role can manage session outcomes"
  ON public.session_outcomes FOR ALL
  USING (current_setting('role')::text = 'service_role')
  WITH CHECK (current_setting('role')::text = 'service_role');

-- ========== From migrations/005_session_feedback.sql ==========
CREATE TABLE IF NOT EXISTS session_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  call_rating SMALLINT NOT NULL CHECK (call_rating BETWEEN 1 AND 5),
  call_feedback TEXT,
  csat_recommend_score SMALLINT NOT NULL CHECK (csat_recommend_score BETWEEN 1 AND 10),
  source TEXT NOT NULL DEFAULT 'end_call' CHECK (source IN ('end_call', 'notes_page', 'api')),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT session_feedback_session_unique UNIQUE (session_id)
);

CREATE INDEX IF NOT EXISTS idx_session_feedback_user_id ON session_feedback (user_id);
CREATE INDEX IF NOT EXISTS idx_session_feedback_submitted_at ON session_feedback (submitted_at DESC);
CREATE INDEX IF NOT EXISTS idx_session_feedback_call_rating ON session_feedback (call_rating);
CREATE INDEX IF NOT EXISTS idx_session_feedback_csat_score ON session_feedback (csat_recommend_score);

ALTER TABLE session_feedback ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role can manage session feedback" ON session_feedback;
CREATE POLICY "Service role can manage session feedback"
  ON session_feedback FOR ALL
  USING (current_setting('role')::text = 'service_role')
  WITH CHECK (current_setting('role')::text = 'service_role');

-- ========== From migrations/006_add_daily_cap_reset.sql ==========
CREATE TABLE IF NOT EXISTS public.users (
  id TEXT PRIMARY KEY,
  daily_cap_reset_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS daily_cap_reset_at TIMESTAMPTZ DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_users_daily_cap_reset ON public.users (daily_cap_reset_at);

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role can manage users" ON public.users;
CREATE POLICY "Service role can manage users"
  ON public.users FOR ALL
  USING (current_setting('role')::text = 'service_role')
  WITH CHECK (current_setting('role')::text = 'service_role');
