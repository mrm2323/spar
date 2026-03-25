-- Cached GPT portrait + patterns for Memory dashboard (invalidates when sessions change)
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
