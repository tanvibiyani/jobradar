-- jobradar initial schema
--
-- All user-scoped tables reference auth.users via user_id and are protected by
-- Row Level Security so that one user cannot see or modify another user's rows.
--
-- Run this once against the Supabase project (psql, the dashboard SQL editor,
-- or `supabase db push` if you use the local CLI). It is idempotent enough to
-- re-run during development thanks to `if not exists` / `drop policy if exists`.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- resumes
-- ---------------------------------------------------------------------------
create table if not exists public.resumes (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  title       text not null,
  content     text,
  file_path   text,
  created_at  timestamptz not null default now()
);

create index if not exists resumes_user_id_idx on public.resumes (user_id);

-- ---------------------------------------------------------------------------
-- preferences (one row per user)
-- ---------------------------------------------------------------------------
create table if not exists public.preferences (
  user_id     uuid primary key references auth.users (id) on delete cascade,
  roles       text[] not null default '{}',
  locations   text[] not null default '{}',
  keywords    text[] not null default '{}',
  min_salary  integer,
  remote      boolean not null default false,
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- companies (per-user watchlist)
-- ---------------------------------------------------------------------------
create table if not exists public.companies (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  name         text not null,
  website      text,
  careers_url  text,
  notes        text,
  created_at   timestamptz not null default now()
);

create index if not exists companies_user_id_idx on public.companies (user_id);

-- ---------------------------------------------------------------------------
-- jobs (postings the user is tracking)
-- ---------------------------------------------------------------------------
create table if not exists public.jobs (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  company_id   uuid references public.companies (id) on delete set null,
  title        text not null,
  url          text,
  location     text,
  description  text,
  posted_at    timestamptz,
  created_at   timestamptz not null default now()
);

create index if not exists jobs_user_id_idx on public.jobs (user_id);
create index if not exists jobs_company_id_idx on public.jobs (company_id);

-- ---------------------------------------------------------------------------
-- job_matches (scoring/triage between a job and a user's resume)
-- ---------------------------------------------------------------------------
create table if not exists public.job_matches (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  job_id      uuid not null references public.jobs (id) on delete cascade,
  resume_id   uuid references public.resumes (id) on delete set null,
  score       numeric,
  reasons     jsonb,
  status      text not null default 'new'
              check (status in ('new', 'saved', 'applied', 'rejected')),
  created_at  timestamptz not null default now(),
  unique (user_id, job_id)
);

create index if not exists job_matches_user_id_idx on public.job_matches (user_id);
create index if not exists job_matches_job_id_idx on public.job_matches (job_id);

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table public.resumes      enable row level security;
alter table public.preferences  enable row level security;
alter table public.companies    enable row level security;
alter table public.jobs         enable row level security;
alter table public.job_matches  enable row level security;

-- A single policy per table covers all four operations: the row's user_id must
-- match the authenticated user, on both read (using) and write (with check).
drop policy if exists "resumes are owner-only" on public.resumes;
create policy "resumes are owner-only" on public.resumes
  for all
  to authenticated
  using      (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists "preferences are owner-only" on public.preferences;
create policy "preferences are owner-only" on public.preferences
  for all
  to authenticated
  using      (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists "companies are owner-only" on public.companies;
create policy "companies are owner-only" on public.companies
  for all
  to authenticated
  using      (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists "jobs are owner-only" on public.jobs;
create policy "jobs are owner-only" on public.jobs
  for all
  to authenticated
  using      (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists "job_matches are owner-only" on public.job_matches;
create policy "job_matches are owner-only" on public.job_matches
  for all
  to authenticated
  using      (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
