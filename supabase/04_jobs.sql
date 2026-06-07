-- jobradar: jobs (postings the user is tracking)
--
-- Apply after 03_companies.sql — the company_id foreign key requires
-- public.companies to exist.

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
create table if not exists public.jobs (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  company_id   uuid references public.companies (id) on delete set null,
  title        text not null,
  url          text,
  location     text,
  description  text,
  posted_at    timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

alter table public.jobs
  add column if not exists updated_at timestamptz not null default now();

create index if not exists jobs_user_id_idx     on public.jobs (user_id);
create index if not exists jobs_company_id_idx  on public.jobs (company_id);
create index if not exists jobs_user_posted_idx
  on public.jobs (user_id, posted_at desc nulls last);

drop trigger if exists set_jobs_updated_at on public.jobs;
create trigger set_jobs_updated_at
  before update on public.jobs
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table public.jobs enable row level security;

drop policy if exists "jobs are owner-only" on public.jobs;

drop policy if exists "jobs select own" on public.jobs;
create policy "jobs select own" on public.jobs
  for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "jobs insert own" on public.jobs;
create policy "jobs insert own" on public.jobs
  for insert to authenticated
  with check (user_id = (select auth.uid()));

drop policy if exists "jobs update own" on public.jobs;
create policy "jobs update own" on public.jobs
  for update to authenticated
  using      (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists "jobs delete own" on public.jobs;
create policy "jobs delete own" on public.jobs
  for delete to authenticated
  using (user_id = (select auth.uid()));
