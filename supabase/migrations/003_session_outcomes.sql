-- Outcomes after real-world conversation (ML / product feedback)
CREATE TABLE IF NOT EXISTS session_outcomes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
  outcome TEXT NOT NULL CHECK (outcome IN ('well', 'tough')),
  user_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT session_outcomes_session_unique UNIQUE (session_id)
);

CREATE INDEX IF NOT EXISTS idx_session_outcomes_session_id ON session_outcomes (session_id);
CREATE INDEX IF NOT EXISTS idx_session_outcomes_created_at ON session_outcomes (created_at DESC);

ALTER TABLE session_outcomes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role can manage session outcomes" ON session_outcomes;
CREATE POLICY "Service role can manage session outcomes"
  ON session_outcomes FOR ALL
  USING (current_setting('role')::text = 'service_role')
  WITH CHECK (current_setting('role')::text = 'service_role');
