-- jobradar: companies (per-user watchlist)
--
-- Apply after 02_preferences.sql. The shared `set_updated_at` function and
-- pgcrypto extension are declared here with idempotent guards so this file
-- can also be applied standalone.

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
create table if not exists public.companies (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  name         text not null,
  website      text,
  careers_url  text,
  notes        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

alter table public.companies
  add column if not exists updated_at timestamptz not null default now();

create index if not exists companies_user_id_idx on public.companies (user_id);
create index if not exists companies_user_name_idx
  on public.companies (user_id, lower(name));

drop trigger if exists set_companies_updated_at on public.companies;
create trigger set_companies_updated_at
  before update on public.companies
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table public.companies enable row level security;

drop policy if exists "companies are owner-only" on public.companies;

drop policy if exists "companies select own" on public.companies;
create policy "companies select own" on public.companies
  for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "companies insert own" on public.companies;
create policy "companies insert own" on public.companies
  for insert to authenticated
  with check (user_id = (select auth.uid()));

drop policy if exists "companies update own" on public.companies;
create policy "companies update own" on public.companies
  for update to authenticated
  using      (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists "companies delete own" on public.companies;
create policy "companies delete own" on public.companies
  for delete to authenticated
  using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- Grants
--
-- The `authenticated` role needs base SQL privileges before RLS is consulted.
-- Without these, Postgres returns "permission denied for table companies"
-- before the policy is even evaluated. grant is idempotent.
-- ---------------------------------------------------------------------------
grant usage on schema public to authenticated;
grant select, insert, update, delete on public.companies to authenticated;
