-- Spar database schema
-- Run this in your Supabase SQL editor

-- Sessions table
create table if not exists sessions (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  scenario text not null check (scenario in (
    'high_stakes', 'difficult_conversation',
    'job_interview', 'salary_negotiation', 'networking',
    'personal_conversation', 'professional_confrontation'
  )),
  context text,
  status text not null default 'active' check (status in ('active', 'completed', 'abandoned')),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  duration_seconds integer,
  vapi_call_id text,
  transcript jsonb,
  created_at timestamptz not null default now()
);

-- Forensics reports
create table if not exists forensics_reports (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references sessions(id) on delete cascade,
  user_id text not null,
  overall_score integer check (overall_score is null or (overall_score between 0 and 100)),
  summary text not null,
  moments jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

-- User memory (Kabir's cross-session knowledge)
create table if not exists user_memory (
  id uuid primary key default gen_random_uuid(),
  user_id text not null unique,
  phone_number text,
  kabir_memory text not null default '',
  patterns text[] not null default '{}',
  weaknesses text[] not null default '{}',
  improvements text[] not null default '{}',
  total_sessions integer not null default 0,
  last_session_at timestamptz,
  updated_at timestamptz not null default now()
);

-- App user row (Clerk user id → daily cap reset; read/written via service role)
create table if not exists users (
  id text primary key,
  daily_cap_reset_at timestamptz default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_users_daily_cap_reset on users(daily_cap_reset_at);

alter table users enable row level security;

create policy "Service role can manage users"
  on users for all
  using (current_setting('role')::text = 'service_role')
  with check (current_setting('role')::text = 'service_role');

-- Indexes
create index if not exists idx_sessions_user_id on sessions(user_id);
create index if not exists idx_sessions_status on sessions(status);
create index if not exists idx_forensics_session_id on forensics_reports(session_id);
create index if not exists idx_forensics_user_id on forensics_reports(user_id);
create index if not exists idx_user_memory_user_id on user_memory(user_id);

-- Cached Memory dashboard (portrait + patterns; keyed by session fingerprint)
create table if not exists user_memory_cache (
  user_id text primary key,
  profile_text text not null default '',
  patterns_json jsonb not null default '[]'::jsonb,
  invalidation_key text not null default '',
  generated_at timestamptz not null default now()
);

create index if not exists idx_user_memory_cache_generated_at
  on user_memory_cache (generated_at desc);

alter table user_memory_cache enable row level security;

create policy "Service role can manage user_memory_cache"
  on user_memory_cache for all
  using (current_setting('role')::text = 'service_role')
  with check (current_setting('role')::text = 'service_role');

-- Session outcomes (post–real-world conversation; optional feedback)
create table if not exists session_outcomes (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references sessions(id) on delete cascade,
  outcome text not null check (outcome in ('well', 'tough')),
  user_note text,
  created_at timestamptz not null default now(),
  constraint session_outcomes_session_unique unique (session_id)
);

create index if not exists idx_session_outcomes_session_id on session_outcomes(session_id);
create index if not exists idx_session_outcomes_created_at on session_outcomes(created_at desc);

alter table session_outcomes enable row level security;

create policy "Service role can manage session outcomes"
  on session_outcomes for all
  using (current_setting('role')::text = 'service_role')
  with check (current_setting('role')::text = 'service_role');

-- Immediate end-of-call feedback (CSAT + recommendation score)
create table if not exists session_feedback (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references sessions(id) on delete cascade,
  user_id text not null,
  call_rating smallint not null check (call_rating between 1 and 5),
  call_feedback text,
  csat_recommend_score smallint not null check (csat_recommend_score between 1 and 10),
  source text not null default 'end_call' check (source in ('end_call', 'notes_page', 'api')),
  metadata jsonb not null default '{}'::jsonb,
  submitted_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint session_feedback_session_unique unique (session_id)
);

create index if not exists idx_session_feedback_user_id on session_feedback(user_id);
create index if not exists idx_session_feedback_submitted_at on session_feedback(submitted_at desc);
create index if not exists idx_session_feedback_call_rating on session_feedback(call_rating);
create index if not exists idx_session_feedback_csat_score on session_feedback(csat_recommend_score);

alter table session_feedback enable row level security;

-- RLS policies
alter table sessions enable row level security;
alter table forensics_reports enable row level security;
alter table user_memory enable row level security;

create policy "Users can read own sessions"
  on sessions for select
  using (user_id = current_setting('request.jwt.claims', true)::json->>'sub');

create policy "Service role can manage sessions"
  on sessions for all
  using (current_setting('role') = 'service_role');

create policy "Users can read own forensics"
  on forensics_reports for select
  using (user_id = current_setting('request.jwt.claims', true)::json->>'sub');

create policy "Service role can manage forensics"
  on forensics_reports for all
  using (current_setting('role') = 'service_role');

create policy "Users can read own memory"
  on user_memory for select
  using (user_id = current_setting('request.jwt.claims', true)::json->>'sub');

create policy "Service role can manage memory"
  on user_memory for all
  using (current_setting('role') = 'service_role');

create policy "Service role can manage session feedback"
  on session_feedback for all
  using (current_setting('role')::text = 'service_role')
  with check (current_setting('role')::text = 'service_role');
