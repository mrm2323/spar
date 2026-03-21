-- Align safety tables with Clerk user IDs (text, e.g. "user_...")
-- Safe to re-run due IF EXISTS guards.

-- Drop user-scoped policies that depend on user_id type before ALTER.
DROP POLICY IF EXISTS "Users can view own crisis logs" ON crisis_logs;
DROP POLICY IF EXISTS "Users can view own dependency flags" ON dependency_flags;
DROP POLICY IF EXISTS "Users can view own safety profile" ON user_safety_profiles;

ALTER TABLE IF EXISTS crisis_logs
  ALTER COLUMN user_id TYPE TEXT USING user_id::text;

ALTER TABLE IF EXISTS content_filter_logs
  ALTER COLUMN user_id TYPE TEXT USING user_id::text;

ALTER TABLE IF EXISTS dependency_flags
  ALTER COLUMN user_id TYPE TEXT USING user_id::text;

ALTER TABLE IF EXISTS boundary_logs
  ALTER COLUMN user_id TYPE TEXT USING user_id::text;

ALTER TABLE IF EXISTS conversation_logs
  ALTER COLUMN user_id TYPE TEXT USING user_id::text;

ALTER TABLE IF EXISTS user_safety_profiles
  ALTER COLUMN user_id TYPE TEXT USING user_id::text;

-- Recreate user-scoped select policies with text comparison.
CREATE POLICY "Users can view own crisis logs" ON crisis_logs
  FOR SELECT USING (auth.uid()::text = user_id);

CREATE POLICY "Users can view own dependency flags" ON dependency_flags
  FOR SELECT USING (auth.uid()::text = user_id);

CREATE POLICY "Users can view own safety profile" ON user_safety_profiles
  FOR SELECT USING (auth.uid()::text = user_id);
