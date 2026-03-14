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
  overall_score integer not null check (overall_score between 0 and 100),
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

-- Indexes
create index if not exists idx_sessions_user_id on sessions(user_id);
create index if not exists idx_sessions_status on sessions(status);
create index if not exists idx_forensics_session_id on forensics_reports(session_id);
create index if not exists idx_forensics_user_id on forensics_reports(user_id);
create index if not exists idx_user_memory_user_id on user_memory(user_id);

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
