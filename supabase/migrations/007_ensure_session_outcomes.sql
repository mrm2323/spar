-- Post–real-conversation check-in ("It went well" / "It was tough") on notes page.
-- Safe if 003 already ran; creates table + policy when missing.

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
