-- Beta waitlist: collect emails, approve manually in Table Editor (status = approved).

create table if not exists beta_waitlist (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  notes text
);

create unique index if not exists beta_waitlist_email_key on beta_waitlist (email);

alter table beta_waitlist enable row level security;

-- No policies for anon: app server uses SUPABASE_SERVICE_ROLE_KEY only.

comment on table beta_waitlist is 'Waitlist signups; set status=approved when ready to grant app access.';
