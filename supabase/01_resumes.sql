-- jobradar: resumes
--
-- Apply the files in this directory in numerical order (01 → 05). Foreign-key
-- dependencies require the previous tables to exist before the later ones can
-- reference them. Each file is idempotent on its own (`if not exists` /
-- `drop … if exists` / `create or replace`), so re-running is safe.

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
create table if not exists public.resumes (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  title       text not null,
  content     text,
  file_path   text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table public.resumes
  add column if not exists updated_at timestamptz not null default now();

-- Make user_id default to the caller's auth.uid() so the application never has
-- to populate it. The BEFORE INSERT trigger below overrides any value the
-- client sends, which keeps the row consistent with the RLS check by
-- construction.
alter table public.resumes
  alter column user_id set default auth.uid();

create index if not exists resumes_user_id_idx on public.resumes (user_id);
create index if not exists resumes_user_created_idx
  on public.resumes (user_id, created_at desc);

drop trigger if exists set_resumes_updated_at on public.resumes;
create trigger set_resumes_updated_at
  before update on public.resumes
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Force-owner trigger
--
-- Pins user_id := auth.uid() on every INSERT regardless of what the client
-- sends. If auth.uid() is null (the request reached PostgREST without a
-- valid JWT) we raise a precise error instead of letting the request fail
-- the RLS check with the opaque "new row violates row-level security
-- policy" message.
-- ---------------------------------------------------------------------------
create or replace function public.resumes_force_owner()
returns trigger
language plpgsql
security invoker
as $$
begin
  new.user_id := auth.uid();
  if new.user_id is null then
    raise exception 'auth.uid() is null at insert time — request is not authenticated'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists resumes_force_owner_trg on public.resumes;
create trigger resumes_force_owner_trg
  before insert on public.resumes
  for each row execute function public.resumes_force_owner();

-- ---------------------------------------------------------------------------
-- Grants
--
-- The `authenticated` role needs base SQL privileges before RLS is consulted.
-- Without these, Postgres returns "permission denied for table resumes"
-- before the policy is even evaluated. grant is idempotent.
-- ---------------------------------------------------------------------------
grant usage on schema public to authenticated;
grant select, insert, update, delete on public.resumes to authenticated;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table public.resumes enable row level security;

-- Legacy single-policy form, dropped here in case it exists from an earlier
-- version of the schema.
drop policy if exists "resumes are owner-only" on public.resumes;

drop policy if exists "resumes select own" on public.resumes;
create policy "resumes select own" on public.resumes
  for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "resumes insert own" on public.resumes;
create policy "resumes insert own" on public.resumes
  for insert to authenticated
  with check (user_id = (select auth.uid()));

drop policy if exists "resumes update own" on public.resumes;
create policy "resumes update own" on public.resumes
  for update to authenticated
  using      (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists "resumes delete own" on public.resumes;
create policy "resumes delete own" on public.resumes
  for delete to authenticated
  using (user_id = (select auth.uid()));
