-- ============================================
-- KABIR AI SAFETY INFRASTRUCTURE
-- Run this migration in Supabase SQL Editor
-- ============================================

-- gen_random_uuid() is built into PostgreSQL 13+ (no extension needed)

-- ============================================
-- CRISIS DETECTION LOGS
-- Records every time we detect crisis signals
-- ============================================
CREATE TABLE IF NOT EXISTS crisis_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT NOT NULL,
    session_id UUID,
    
    -- The message that triggered detection
    message_text TEXT NOT NULL,
    
    -- Detection results
    detection_level TEXT NOT NULL CHECK (detection_level IN ('NONE', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
    indicators TEXT[] DEFAULT '{}',
    confidence_score DECIMAL(3,2),
    
    -- Response given
    response_type TEXT NOT NULL CHECK (response_type IN ('NORMAL', 'SUPPORTIVE', 'RESOURCES_PROVIDED', 'ESCALATED')),
    response_text TEXT,
    resources_shown TEXT[],
    
    -- Follow-up
    escalated_to_human BOOLEAN DEFAULT false,
    user_acknowledged_safe BOOLEAN,
    follow_up_scheduled BOOLEAN DEFAULT false,
    
    -- Metadata
    detected_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for querying by user and severity
CREATE INDEX idx_crisis_logs_user_level ON crisis_logs(user_id, detection_level);
CREATE INDEX idx_crisis_logs_created ON crisis_logs(created_at DESC);

-- ============================================
-- CONTENT FILTER LOGS
-- Records when we block or modify responses
-- ============================================
CREATE TABLE IF NOT EXISTS content_filter_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT NOT NULL,
    session_id UUID,
    
    -- What triggered the filter
    trigger_type TEXT NOT NULL CHECK (trigger_type IN ('HARMFUL_CONTENT', 'JAILBREAK_ATTEMPT', 'BOUNDARY_VIOLATION', 'DEPENDENCY_LANGUAGE', 'PROFESSIONAL_BOUNDARY')),
    trigger_details TEXT,
    
    -- The content
    original_user_message TEXT,
    original_ai_response TEXT,
    modified_ai_response TEXT,
    
    -- Action taken
    action_taken TEXT NOT NULL CHECK (action_taken IN ('BLOCKED', 'MODIFIED', 'FLAGGED', 'ALLOWED_WITH_WARNING')),
    modification_reason TEXT,
    
    -- Metadata
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_content_filter_user ON content_filter_logs(user_id);
CREATE INDEX idx_content_filter_type ON content_filter_logs(trigger_type);

-- ============================================
-- DEPENDENCY FLAGS
-- Tracks users showing unhealthy attachment patterns
-- ============================================
CREATE TABLE IF NOT EXISTS dependency_flags (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT NOT NULL,
    
    -- Flag details
    flag_type TEXT NOT NULL CHECK (flag_type IN ('HIGH_USAGE', 'ISOLATION_LANGUAGE', 'ATTACHMENT_LANGUAGE', 'LATE_NIGHT_PATTERN', 'NO_HUMAN_SUPPORT_MENTIONED')),
    evidence TEXT NOT NULL,
    severity TEXT NOT NULL CHECK (severity IN ('LOW', 'MEDIUM', 'HIGH')),
    
    -- Intervention
    intervention_sent BOOLEAN DEFAULT false,
    intervention_message TEXT,
    intervention_sent_at TIMESTAMPTZ,
    
    -- Resolution
    resolved BOOLEAN DEFAULT false,
    resolution_notes TEXT,
    resolved_at TIMESTAMPTZ,
    
    -- Metadata
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_dependency_flags_user ON dependency_flags(user_id);
CREATE INDEX idx_dependency_flags_unresolved ON dependency_flags(user_id) WHERE resolved = false;

-- ============================================
-- USER SAFETY PROFILE
-- Aggregated safety status per user
-- ============================================
CREATE TABLE IF NOT EXISTS user_safety_profiles (
    user_id TEXT PRIMARY KEY,
    
    -- Crisis history
    total_crisis_detections INTEGER DEFAULT 0,
    highest_crisis_level TEXT DEFAULT 'NONE',
    last_crisis_at TIMESTAMPTZ,
    
    -- Dependency risk
    dependency_risk_score DECIMAL(3,2) DEFAULT 0,
    dependency_flags_active INTEGER DEFAULT 0,
    last_dependency_flag_at TIMESTAMPTZ,
    
    -- Usage patterns
    messages_today INTEGER DEFAULT 0,
    messages_this_week INTEGER DEFAULT 0,
    late_night_messages_this_week INTEGER DEFAULT 0,
    average_session_length_minutes INTEGER DEFAULT 0,
    
    -- Interventions
    interventions_sent_total INTEGER DEFAULT 0,
    last_intervention_at TIMESTAMPTZ,
    
    -- Status
    requires_review BOOLEAN DEFAULT false,
    review_reason TEXT,
    reviewed_at TIMESTAMPTZ,
    reviewed_by TEXT,
    
    -- Metadata
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- PROFESSIONAL BOUNDARY LOGS
-- When users try to get medical/therapy advice
-- ============================================
CREATE TABLE IF NOT EXISTS boundary_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT NOT NULL,
    
    -- What was requested
    boundary_type TEXT NOT NULL CHECK (boundary_type IN ('DIAGNOSIS_REQUEST', 'MEDICATION_ADVICE', 'THERAPY_REQUEST', 'MEDICAL_EMERGENCY', 'LEGAL_ADVICE', 'CONFIDENTIALITY_REQUEST')),
    user_message TEXT NOT NULL,
    
    -- How we responded
    response_given TEXT NOT NULL,
    resources_provided TEXT[],
    
    -- Metadata
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_boundary_logs_user ON boundary_logs(user_id);

-- ============================================
-- SAFETY DAILY SUMMARY
-- Aggregated daily stats for monitoring
-- ============================================
CREATE TABLE IF NOT EXISTS safety_daily_summary (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    summary_date DATE NOT NULL UNIQUE,
    
    -- Crisis stats
    total_crisis_detections INTEGER DEFAULT 0,
    critical_crisis_count INTEGER DEFAULT 0,
    high_crisis_count INTEGER DEFAULT 0,
    
    -- Content filter stats
    total_content_filtered INTEGER DEFAULT 0,
    jailbreak_attempts INTEGER DEFAULT 0,
    harmful_content_blocked INTEGER DEFAULT 0,
    
    -- Dependency stats
    new_dependency_flags INTEGER DEFAULT 0,
    interventions_sent INTEGER DEFAULT 0,
    
    -- User stats
    users_flagged_for_review INTEGER DEFAULT 0,
    
    -- Metadata
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_safety_summary_date ON safety_daily_summary(summary_date DESC);

-- ============================================
-- ROW LEVEL SECURITY
-- Ensure users can only see their own data
-- ============================================

ALTER TABLE crisis_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE content_filter_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE dependency_flags ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_safety_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE boundary_logs ENABLE ROW LEVEL SECURITY;

-- Policies for authenticated users (can only see own data)
CREATE POLICY "Users can view own crisis logs" ON crisis_logs
    FOR SELECT USING (auth.uid()::text = user_id);

CREATE POLICY "Users can view own dependency flags" ON dependency_flags
    FOR SELECT USING (auth.uid()::text = user_id);

CREATE POLICY "Users can view own safety profile" ON user_safety_profiles
    FOR SELECT USING (auth.uid()::text = user_id);

-- Service role can do everything (for edge functions)
CREATE POLICY "Service role full access crisis_logs" ON crisis_logs
    FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "Service role full access content_filter" ON content_filter_logs
    FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "Service role full access dependency" ON dependency_flags
    FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "Service role full access safety_profiles" ON user_safety_profiles
    FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "Service role full access boundary" ON boundary_logs
    FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "Service role full access summary" ON safety_daily_summary
    FOR ALL USING (auth.role() = 'service_role');

-- Conversation logs (privacy-preserving)
CREATE TABLE IF NOT EXISTS conversation_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT NOT NULL,
    session_id UUID,
    message_count INTEGER DEFAULT 0,
    had_crisis_context BOOLEAN DEFAULT false,
    had_memory_context BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_conversation_logs_user ON conversation_logs(user_id);
CREATE INDEX idx_conversation_logs_created ON conversation_logs(created_at DESC);

-- RLS
ALTER TABLE conversation_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access conversation_logs" ON conversation_logs
    FOR ALL USING (auth.role() = 'service_role');
