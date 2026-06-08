-- jobradar: preferences (one row per user)
--
-- Apply after 01_resumes.sql. The shared `set_updated_at` function is created
-- there; we redeclare it here with `create or replace` so this file can also
-- be applied standalone during development.

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
create table if not exists public.preferences (
  user_id     uuid primary key references auth.users (id) on delete cascade,
  roles       text[] not null default '{}',
  locations   text[] not null default '{}',
  keywords    text[] not null default '{}',
  min_salary  integer,
  remote      boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table public.preferences
  add column if not exists updated_at timestamptz not null default now();

drop trigger if exists set_preferences_updated_at on public.preferences;
create trigger set_preferences_updated_at
  before update on public.preferences
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table public.preferences enable row level security;

drop policy if exists "preferences are owner-only" on public.preferences;

drop policy if exists "preferences select own" on public.preferences;
create policy "preferences select own" on public.preferences
  for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "preferences insert own" on public.preferences;
create policy "preferences insert own" on public.preferences
  for insert to authenticated
  with check (user_id = (select auth.uid()));

drop policy if exists "preferences update own" on public.preferences;
create policy "preferences update own" on public.preferences
  for update to authenticated
  using      (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists "preferences delete own" on public.preferences;
create policy "preferences delete own" on public.preferences
  for delete to authenticated
  using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- Grants
--
-- The `authenticated` role needs base SQL privileges before RLS is consulted.
-- Without these, Postgres returns "permission denied for table preferences"
-- before the policy is even evaluated. grant is idempotent.
-- ---------------------------------------------------------------------------
grant usage on schema public to authenticated;
grant select, insert, update, delete on public.preferences to authenticated;
