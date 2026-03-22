-- Immediate end-of-call feedback (CSAT + NPS style signal)
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
-- Writes/reads are done via Next.js API with service role (bypasses RLS).
