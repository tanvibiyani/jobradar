-- jobradar: job_matches (scoring/triage between a job and a user's resume)
--
-- Apply last. Foreign keys require public.jobs (04) and public.resumes (01) to
-- exist.

create extension if not exists "pgcrypto";

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Table
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
  updated_at  timestamptz not null default now(),
  unique (user_id, job_id)
);

alter table public.job_matches
  add column if not exists updated_at timestamptz not null default now();

create index if not exists job_matches_user_id_idx on public.job_matches (user_id);
create index if not exists job_matches_job_id_idx  on public.job_matches (job_id);
create index if not exists job_matches_user_status_idx
  on public.job_matches (user_id, status);
create index if not exists job_matches_user_score_idx
  on public.job_matches (user_id, score desc nulls last);

drop trigger if exists set_job_matches_updated_at on public.job_matches;
create trigger set_job_matches_updated_at
  before update on public.job_matches
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table public.job_matches enable row level security;

drop policy if exists "job_matches are owner-only" on public.job_matches;

drop policy if exists "job_matches select own" on public.job_matches;
create policy "job_matches select own" on public.job_matches
  for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "job_matches insert own" on public.job_matches;
create policy "job_matches insert own" on public.job_matches
  for insert to authenticated
  with check (user_id = (select auth.uid()));

drop policy if exists "job_matches update own" on public.job_matches;
create policy "job_matches update own" on public.job_matches
  for update to authenticated
  using      (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists "job_matches delete own" on public.job_matches;
create policy "job_matches delete own" on public.job_matches
  for delete to authenticated
  using (user_id = (select auth.uid()));
